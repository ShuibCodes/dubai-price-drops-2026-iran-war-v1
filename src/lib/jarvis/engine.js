import Anthropic from "@anthropic-ai/sdk";
import { startColdBatch } from "@/lib/copilot/tools";
import { draftLeadEmail, sendDraftEmail } from "@/lib/jarvis/email";
import {
  getJarvisCallDetail,
  getJarvisInboxActivity,
  getJarvisInboxStats,
  getJarvisLatestMessages,
  getJarvisLeadStory,
  getJarvisPendingCallbacks,
  getJarvisStaleConversations,
  getJarvisUnrepliedConversations,
  searchJarvisConversations,
  searchJarvisLeadByName,
  setJarvisLeadName,
  startJarvisTargetCall,
} from "@/lib/jarvis/leads-tools";
import {
  PLACE_RELAY_CALL_DESCRIPTION,
  formatRelayConfirmation,
  placeRelayCall,
} from "@/lib/jarvis/relay";
import { getJarvisRecentConversations, formatLiveContext } from "@/lib/kb/live-conversations";

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 5;
// Default Sterling AZ personal workspace. Override with JARVIS_TENANT_SLUG env
// if a host (e.g. Railway) still needs to be flipped without a code change.
export const JARVIS_TENANT_SLUG =
  String(process.env.JARVIS_TENANT_SLUG || "sterling").trim() || "sterling";

export const jarvisToolDefinitions = [
  {
    name: "get_latest_messages",
    description:
      "Get the most recent WhatsApp messages across ALL threads, newest first, with sender name, phone, and direction. Use for 'last message?', 'who messaged recently?', 'anything new?'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
    },
  },
  {
    name: "search_lead_by_name",
    description:
      "Fuzzy-search leads by partial name. Use before get_lead_story, start_target_call, or draft_email.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "get_lead_story",
    description:
      "Full chronological WhatsApp + call history for one lead. Requires leadId from search.",
    input_schema: {
      type: "object",
      properties: { leadId: { type: "string", format: "uuid" } },
      required: ["leadId"],
    },
  },
  {
    name: "search_conversations",
    description:
      "Search live WhatsApp message bodies and call transcripts. Use for 'who said X' questions.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get_call_detail",
    description:
      "Fetch one call's details/transcript. Summarize in 1-5 lines; never paste the full transcript.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string", format: "uuid" },
        callId: { type: "string", format: "uuid" },
      },
    },
  },
  {
    name: "get_pending_callbacks",
    description: "List leads whose latest call outcome is a callback with a callback time.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_unreplied_conversations",
    description:
      "List WhatsApp threads that need a reply: latest message in the window is inbound. Use for 'who do I need to reply to?', 'anyone waiting on me?', 'unanswered in 72h'. Prefer this over get_latest_messages for unreplied scans. Returns at most `limit` (default 15).",
    input_schema: {
      type: "object",
      properties: {
        hours: { type: "integer", minimum: 1, maximum: 336, default: 72 },
        limit: { type: "integer", minimum: 1, maximum: 30, default: 15 },
      },
    },
  },
  {
    name: "get_inbox_activity",
    description:
      "List distinct WhatsApp threads active in a time window, newest first. Set inboundOnly for 'who texted me today/overnight'. Use for overnight/activity scans — not for unreplied (use get_unreplied_conversations).",
    input_schema: {
      type: "object",
      properties: {
        hours: { type: "integer", minimum: 1, maximum: 336, default: 72 },
        limit: { type: "integer", minimum: 1, maximum: 30, default: 15 },
        inboundOnly: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "get_stale_conversations",
    description:
      "List threads where the latest message is outbound and older than `hours` — you messaged them and they have not replied. Use for 'who hasn't replied?', 'cold/stale conversations'.",
    input_schema: {
      type: "object",
      properties: {
        hours: { type: "integer", minimum: 1, maximum: 336, default: 72 },
        limit: { type: "integer", minimum: 1, maximum: 30, default: 15 },
      },
    },
  },
  {
    name: "get_inbox_stats",
    description:
      "Aggregate inbox counts for a window: messages, threads, inbound, outbound, unreplied, staleOutbound. Use for 'how many chats/unanswered in 72h?'",
    input_schema: {
      type: "object",
      properties: {
        hours: { type: "integer", minimum: 1, maximum: 336, default: 72 },
      },
    },
  },
  {
    name: "set_lead_name",
    description:
      "Save an authoritative first name for a WhatsApp contact (writes push_name). Use when the user confirms a medium guess (Name?) or explicitly names a contact. Pass leadId and/or phone plus name.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string", format: "uuid" },
        phone: { type: "string" },
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "place_relay_call",
    description: PLACE_RELAY_CALL_DESCRIPTION,
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Who to call, as the user said it",
        },
        task: {
          type: "string",
          description:
            "Rewritten speakable message for the recipient (see tool description rules)",
        },
        phone: {
          type: "string",
          description: "Optional E.164 / digits if the user gave a number",
        },
        forceAfterHours: {
          type: "boolean",
          description: "Set true only after user explicitly overrides the 08:00–21:00 Gulf window",
        },
        forceCooldown: {
          type: "boolean",
          description:
            "Set true only after user insists on a second relay to the same number within 10 minutes",
        },
      },
      required: ["name", "task"],
    },
  },
  {
    name: "start_target_call",
    description:
      "Place a Vapi outbound call to one lead using the configured cold-call assistant. ONLY after the user explicitly confirmed in the latest message. Do NOT use when the user wants a message relayed — use place_relay_call.",
    input_schema: {
      type: "object",
      properties: { leadId: { type: "string", format: "uuid" } },
      required: ["leadId"],
    },
  },
  {
    name: "start_cold_batch",
    description:
      "Start/queue cold calls to uncalled Purchased-list leads via Vapi. ONLY after explicit user confirmation. Pass country to limit market (e.g. 971 / UAE).",
    input_schema: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1 },
        country: { type: "string" },
      },
      required: ["count"],
    },
  },
  {
    name: "draft_email",
    description:
      "Draft a follow-up email from live WhatsApp context. Does NOT send. Show the draft and ask the user to confirm before send_email.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string", format: "uuid" },
        name: { type: "string" },
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        intent: { type: "string" },
      },
    },
  },
  {
    name: "send_email",
    description:
      "Send an email via Resend. ONLY after the user explicitly confirmed the draft in the latest message.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
];

function systemPrompt({ liveContext }) {
  return `You are Jarvis — a live WhatsApp knowledge base and action desk.

DATA SOURCE (CRITICAL):
- Your primary knowledge is the owner's connected WhatsApp Business inbox, continuously ingested via Whautomate coexistence into Supabase. These are the owner's own business conversations.
- Every new inbound or outbound WhatsApp on the connected business number lands in near real time. Treat the tool results as current, not a static dump.
- You also have call history from Vapi outbound calls (same assistant used for cold calling).
- Never invent chats, phones, emails, budgets, or outcomes. If tools return nothing, say so.

RESPONSE STYLE:
- Be clear, practical, and conversational — a capable teammate, not a dashboard.
- Lead with the answer. Use short bullets when listing people.
- Include full phone numbers when discussing a specific lead (E.164, e.g. +971...).
- When leadName is null, say Unknown and lead with the phone number.
- leadName ending with "?" means medium-confidence inferred name — a working label, not certain. Offer once: "I think +971… is Tom — want me to save that?" On yes, call set_lead_name.
- High-confidence inferred names (no "?") are fine as working labels; do not claim them as verified CRM facts.
- When quoting WhatsApp, keep excerpts short and attribute direction (lead vs me) plus rough recency.
- Markdown is fine. No emojis unless the user uses them first.

LOOKUPS:
- "Last/latest message", "who messaged recently", "anything new" → get_latest_messages FIRST. Do not answer recency questions from the snapshot alone.
- "Who do I need to reply to", "anyone waiting on me", "unanswered / unreplied in N hours" → get_unreplied_conversations FIRST (pass hours). Never scan with N× get_lead_story.
- "Who texted me / overnight / activity in the last N hours" → get_inbox_activity (inboundOnly when they only want inbound).
- "Who hasn't replied", "stale / cold conversations" → get_stale_conversations.
- "How many chats / unanswered / inbox stats" → get_inbox_stats.
- When listing people from inbox tools, show at most ~15 bullets (name + phone + short snippet + age). Keep WhatsApp-friendly length.
- Name questions → search_lead_by_name, then get_lead_story.
- "What did anyone say about X" → search_conversations, then get_lead_story / get_call_detail.
- Call recaps → get_call_detail; summarize 1-5 lines; never paste transcripts.
- Callbacks → get_pending_callbacks.
- Saving/confirming a contact name → set_lead_name (user-supplied only; never invent).

ACTIONS — CALLS (Vapi):
- "call X and tell/ask them Y" → ALWAYS place_relay_call (relay assistant). Rewrite Y into the spoken task per the tool description. Never use start_target_call for a relay/message.
- "call X" with no message to relay → start_target_call (Jarvis personal assistant only). Never the Allan/Pixxi cold-call assistant.
- start_target_call dials one lead with tenants.vapi_assistant_id_jarvis ONLY.
- start_cold_batch queues/dials Purchased-list leads through that same Vapi path.
- NEVER place a call on the first ask. For lead calls: restate name + phone, ask: "Ready to call {Name} at {phone} — reply yes to place the Vapi call."
- For relays: confirmation is handled after place_relay_call returns needs_confirmation — show name, number, and the exact task line.
- Only call start_target_call / start_cold_batch after the user's latest message is an explicit yes/confirm/go ahead.
- For cold batches over 100, restate the count and require an explicit yes.
- If outside the lead's local business hours, the tool may queue — explain that clearly.
- Relay calls are blocked 21:00–08:00 Gulf time unless the user explicitly overrides.

ACTIONS — EMAIL (Resend):
- draft_email first (never send on the first ask). Show To / Subject / Body.
- If missingEmail is true, ask the user for the address before sending.
- Only call send_email after the user explicitly confirms the draft ("yes", "send it", etc.).
- Prefer live WhatsApp context when drafting. Do not invent an email address.

SAFETY:
- No login on this chat surface — be careful with sensitive details but still answer operational questions from tool data.
- Do not claim you can message on WhatsApp from this UI (ingestion is live; outbound WhatsApp bot is separate).
- The workspace is resolved server-side. Never ask for a tenant ID and never label the data as belonging to any client or tenant — these are the owner's own WhatsApp conversations.

LIVE SNAPSHOT (recent WhatsApp threads — may be incomplete; use tools for deep lookup):
${liveContext || "(no recent conversations loaded)"}`;
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => ["user", "assistant"].includes(message?.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 12000),
    }))
    .slice(-30);
}

function latestUserAffirmed(messages) {
  const history = normalizeMessages(messages);
  const latest = history.at(-1);
  if (latest?.role !== "user") return false;
  return /^(yes|y|yeah|yep|confirm|confirmed|go ahead|do it|proceed|send it|send|call)\b/i.test(
    latest.content.trim()
  );
}

function previousAssistantMentioned(messages, pattern) {
  const history = normalizeMessages(messages);
  const previous = [...history].reverse().find((message) => message.role === "assistant");
  return previous ? pattern.test(previous.content) : false;
}

async function executeTool({ name, input, tenantId, agentName, messages, senderPhone }) {
  switch (name) {
    case "get_latest_messages":
      return getJarvisLatestMessages(tenantId, input.limit);
    case "search_lead_by_name":
      return searchJarvisLeadByName(tenantId, input.name);
    case "get_lead_story":
      return getJarvisLeadStory(tenantId, input.leadId);
    case "search_conversations":
      return searchJarvisConversations(tenantId, input.query);
    case "get_call_detail":
      return getJarvisCallDetail(tenantId, input);
    case "get_pending_callbacks":
      return getJarvisPendingCallbacks(tenantId);
    case "get_unreplied_conversations":
      return getJarvisUnrepliedConversations(tenantId, input);
    case "get_inbox_activity":
      return getJarvisInboxActivity(tenantId, input);
    case "get_stale_conversations":
      return getJarvisStaleConversations(tenantId, input);
    case "get_inbox_stats":
      return getJarvisInboxStats(tenantId, input);
    case "set_lead_name":
      return setJarvisLeadName(tenantId, input);
    case "place_relay_call": {
      const result = await placeRelayCall({
        tenantId,
        senderPhone,
        name: input.name,
        task: input.task,
        phone: input.phone,
        forceAfterHours: Boolean(input.forceAfterHours),
        forceCooldown: Boolean(input.forceCooldown),
      });
      if (result?.status === "needs_confirmation") {
        return {
          ...result,
          requiresConfirmation: true,
          action: "relay",
        };
      }
      return result;
    }
    case "start_target_call": {
      if (
        !latestUserAffirmed(messages) ||
        !previousAssistantMentioned(messages, /ready to call|place the vapi call|confirm.*call/i)
      ) {
        return {
          requiresConfirmation: true,
          action: "call",
          instruction:
            "Ask the user to confirm the call (name + phone). Do not call the tool again this turn.",
        };
      }
      return startJarvisTargetCall(tenantId, input.leadId, agentName || "Jarvis");
    }
    case "start_cold_batch": {
      const count = Number(input.count);
      if (!latestUserAffirmed(messages)) {
        return {
          requiresConfirmation: true,
          action: "cold_batch",
          count,
          instruction: `Ask the user to explicitly confirm starting ${count} cold calls. Do not call the tool again this turn.`,
        };
      }
      if (
        count > 100 &&
        !previousAssistantMentioned(messages, new RegExp(String(count)))
      ) {
        return {
          requiresConfirmation: true,
          action: "cold_batch",
          count,
          instruction: `Ask the user to explicitly confirm starting ${count} cold calls. Do not call the tool again this turn.`,
        };
      }
      return startColdBatch(tenantId, count, agentName || "Jarvis", input.country);
    }
    case "draft_email":
      return draftLeadEmail(tenantId, input);
    case "send_email": {
      if (
        !latestUserAffirmed(messages) ||
        !previousAssistantMentioned(messages, /ready to send|reply yes to send|confirm.*email|send this email/i)
      ) {
        return {
          requiresConfirmation: true,
          action: "email",
          instruction:
            "Show the draft and ask the user to confirm before sending. Do not call send_email again this turn.",
        };
      }
      return sendDraftEmail(input);
    }
    default:
      throw new Error(`Unknown Jarvis tool: ${name}`);
  }
}

export async function runJarvisTurn({ tenantId, messages, agentName, senderPhone }) {
  if (!tenantId) throw new Error("Resolved tenant ID is required");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  let liveContext = "";
  try {
    const conversations = await getJarvisRecentConversations(tenantId, {
      limit: 5,
      messageLimit: 8,
    });
    liveContext = formatLiveContext(conversations);
  } catch (error) {
    console.error("[jarvis] live context unavailable:", error.message);
  }

  const client = new Anthropic({ apiKey });
  const conversation = normalizeMessages(messages);
  if (!conversation.length || conversation.at(-1).role !== "user") {
    throw new Error("A final user message is required");
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1400,
      system: systemPrompt({ liveContext }),
      tools: jarvisToolDefinitions,
      messages: conversation,
    });

    const toolUses = response.content.filter((block) => block.type === "tool_use");
    if (!toolUses.length) {
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      return { text: text || "I couldn't produce a response.", toolRounds: round };
    }

    conversation.push({ role: "assistant", content: response.content });
    const results = [];
    let confirmation = null;
    for (const toolUse of toolUses) {
      try {
        const result = await executeTool({
          name: toolUse.name,
          input: toolUse.input || {},
          tenantId,
          agentName,
          messages,
          senderPhone,
        });
        if (result?.requiresConfirmation) confirmation = result;
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: JSON.stringify({ error: error.message }),
        });
      }
    }

    if (confirmation) {
      if (confirmation.action === "relay") {
        return {
          text:
            confirmation.confirmationPrompt ||
            formatRelayConfirmation({
              name: confirmation.name,
              phone: confirmation.phone,
              task: confirmation.task,
            }),
          toolRounds: round + 1,
        };
      }
      if (confirmation.action === "cold_batch") {
        return {
          text: `You’re about to start a cold batch of ${confirmation.count} Vapi calls. Reply “yes” to confirm.`,
          toolRounds: round + 1,
        };
      }
      if (confirmation.action === "email") {
        return {
          text: "I need an explicit yes before sending that email. Reply “yes” to send the draft above.",
          toolRounds: round + 1,
        };
      }
      return {
        text: "I need an explicit yes before placing that Vapi call. Reply “yes” to dial.",
        toolRounds: round + 1,
      };
    }

    conversation.push({ role: "user", content: results });
  }

  throw new Error("Jarvis exceeded the maximum of 5 tool rounds");
}

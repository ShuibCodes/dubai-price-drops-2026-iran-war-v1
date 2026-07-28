import Anthropic from "@anthropic-ai/sdk";
import { startColdBatch } from "@/lib/copilot/tools";
import { draftLeadEmail, sendDraftEmail } from "@/lib/jarvis/email";
import {
  getJarvisCallDetail,
  getJarvisLatestMessages,
  getJarvisLeadStory,
  getJarvisPendingCallbacks,
  searchJarvisConversations,
  searchJarvisLeadByName,
  startJarvisTargetCall,
} from "@/lib/jarvis/leads-tools";
import { getJarvisRecentConversations, formatLiveContext } from "@/lib/kb/live-conversations";

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 5;
export const JARVIS_TENANT_SLUG = "1416";

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
    name: "start_target_call",
    description:
      "Place a Vapi outbound call to one lead using the configured cold-call assistant. ONLY after the user explicitly confirmed in the latest message.",
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
- When quoting WhatsApp, keep excerpts short and attribute direction (lead vs me) plus rough recency.
- Markdown is fine. No emojis unless the user uses them first.

LOOKUPS:
- "Last/latest message", "who messaged recently", "anything new" → get_latest_messages FIRST. Do not answer recency questions from the snapshot alone.
- Name questions → search_lead_by_name, then get_lead_story.
- "What did anyone say about X" → search_conversations, then get_lead_story / get_call_detail.
- Call recaps → get_call_detail; summarize 1-5 lines; never paste transcripts.
- Callbacks → get_pending_callbacks.

ACTIONS — CALLS (Vapi):
- start_target_call dials one lead with the SAME Vapi assistant + Twilio/Vapi phone number already configured for cold calling.
- start_cold_batch queues/dials Purchased-list leads through that same Vapi path.
- NEVER place a call on the first ask. First resolve the lead, restate name + phone, and ask: "Ready to call {Name} at {phone} — reply yes to place the Vapi call."
- Only call start_target_call / start_cold_batch after the user's latest message is an explicit yes/confirm/go ahead.
- For cold batches over 100, restate the count and require an explicit yes.
- If outside the lead's local business hours, the tool may queue — explain that clearly.

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

async function executeTool({ name, input, tenantId, agentName, messages }) {
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

export async function runJarvisTurn({ tenantId, messages, agentName }) {
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

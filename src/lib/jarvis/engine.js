import Anthropic from "@anthropic-ai/sdk";
import { listLeadSources, listScripts, startColdBatch } from "@/lib/copilot/tools";
import {
  formatRunStatusBlock,
  getRunStatus,
  shouldPrefetchRunStatus,
} from "@/lib/console/run-status";
import {
  formatSavedListsPrompt,
  listSavedLists,
  matchSavedList,
} from "@/lib/console/lists";
import { getSupabaseServerClient } from "@/lib/supabase/server";
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
  SAVE_JARVIS_CONTACT_DESCRIPTION,
  formatContactConfirmation,
  saveJarvisContact,
} from "@/lib/jarvis/contacts";
import {
  PLACE_RELAY_CALL_DESCRIPTION,
  formatRelayConfirmation,
  placeRelayCall,
} from "@/lib/jarvis/relay";
import { getJarvisRecentConversations, formatLiveContext } from "@/lib/kb/live-conversations";
import {
  buildScriptBatchConfirm,
  isResolvedMatch,
  resolveFailurePayload,
  resolveScript,
  scriptRequiredPayload,
} from "@/lib/scripts/resolve";
import { HELP_TEXT, isHelpMessage } from "@/lib/console/help";

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 5;
// Fallback slug for /api/jarvis/chat and scripts when no sender phone is sent.
// Live AZ WhatsApp does not use this — it resolves tenant from agents.wa_id.
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
      "Fuzzy-search WhatsApp inbox contacts by name. Do not use for saved list / campaign names — those are in SAVED LISTS and list_lead_sources.",
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
    name: "get_run_status",
    description:
      "Status of a console / WhatsApp call run (call_batches). Use for 'how's the run', 'how many dialled', 'who is worth my time', 'qualified from the marina list', 'status of the cold list'. Defaults to the latest run. Returns dialled/total, qualified, and up to 5 worth-your-time people (name, phone, HOT/WARM, one-line quote). Do not use inbox tools for this.",
    input_schema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "Optional live script name, e.g. 'cold list'.",
        },
        list: {
          type: "string",
          description: "Optional saved list name from the console run.",
        },
      },
    },
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
    name: "save_jarvis_contact",
    description: SAVE_JARVIS_CONTACT_DESCRIPTION,
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Contact name exactly as the user wants it saved",
        },
        phone: {
          type: "string",
          description: "Phone in any international format (e.g. +4477…, 9715…)",
        },
      },
      required: ["name", "phone"],
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
    name: "list_scripts",
    description:
      "List this tenant's named call scripts. Returns live (published, may dial) and drafts (cannot dial) as separate arrays plus an instruction. Read live first. Never tell the user all scripts are draft when live is non-empty. Never invent a script name.",
    input_schema: { type: "object", properties: {} },
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
    name: "list_lead_sources",
    description:
      "List this tenant's saved lead lists (leads.source) with counts. Use when the user says 'call my X list' or asks what lists they have. Pass the matching source string to start_cold_batch.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "start_cold_batch",
    description:
      "Start/queue cold calls to a saved lead list via Vapi. script is required (must be LIVE). source is the list name. ONLY after explicit user confirmation. Never fall back to a default script.",
    input_schema: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1 },
        country: { type: "string" },
        source: {
          type: "string",
          description:
            "Saved list name from SAVED LISTS (exact string, e.g. 'test list'). Omit only when THIS TURN already named the list.",
        },
        script: {
          type: "string",
          description:
            "Required. Named LIVE script to dial with (e.g. 'cold list'). On no match, list live names. On ambiguous, offer the top two.",
        },
      },
      required: ["script"],
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

function systemPrompt({ liveContext, savedListsPrompt, agentName, runStatusBlock }) {
  const who = String(agentName || "").trim() || "the agent";
  return `You are Jarvis — a live WhatsApp knowledge base and action desk.

AGENT NAME: ${who}
You are talking to ${who}. For relay voice tasks, the call opening already says "message from ${who.split(/\s+/)[0]}". Never invent a different sender name.

DATA SOURCE (CRITICAL):
- Your primary knowledge is the owner's connected WhatsApp Business inbox, continuously ingested via Whautomate coexistence into Supabase. These are the owner's own business conversations.
- Every new inbound or outbound WhatsApp on the connected business number lands in near real time. Treat the tool results as current, not a static dump.
- You also have call history from Vapi outbound calls (same assistant used for cold calling).
- Console call runs (call_batches) ARE available here via get_run_status and THIS TURN — CONSOLE RUN. Never say dial counts do not come through WhatsApp. Never send the agent to the Vapi dashboard for a run question.
- Saved dial lists from the console are listed under SAVED LISTS below. They are a different table from WhatsApp contacts. Never invent chats, phones, emails, budgets, or outcomes. If tools return nothing, say so.

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
- Saved list / "call my X list" / a name that appears in SAVED LISTS → list_lead_sources or start_cold_batch. Never search_lead_by_name for a list.
- Person name questions → search_lead_by_name, then get_lead_story.
- "What did anyone say about X" → search_conversations, then get_lead_story / get_call_detail.
- Call recaps for one named person → get_call_detail; summarize 1-5 lines; never paste transcripts.
- Console / batch run status ("how's the run", "how many dialled", "who is worth my time", "qualified from this afternoon", named list or script) → use THIS TURN — CONSOLE RUN if present, otherwise get_run_status FIRST. Do not use inbox tools or get_pending_callbacks for this.
- Follow the run instruction. Always say dialed/total dialled. If ask_again_later is true, include exactly: "Ask me again later please." Then list worth as name, full phone, tone, and the quote in quotes — same shape as the console card. Never paste a full transcript. If worth is empty, still report the counts.
- Callbacks (inbox, not a console run) → get_pending_callbacks.
- Saving/confirming a contact name on an EXISTING lead → set_lead_name (user-supplied only; never invent).
- Adding a NEW contact (name + phone) → save_jarvis_contact. Show the confirmationPrompt (name + number) and wait for yes — do not claim they are saved until the yes handler completes.
- If place_relay_call returns not_found, ask for the phone. Once they give it, call place_relay_call again WITH phone (that path saves + dials on yes), or save_jarvis_contact then place_relay_call.

ACTIONS — CALLS (Vapi):
- "call X and tell/ask them Y" → ALWAYS place_relay_call (relay assistant). Rewrite Y into the spoken task per the tool description. Never use start_target_call for a relay/message.
- After relays, use get_lead_story / get_call_detail — there may be multiple recent relay calls. Prefer the latest completed one with a transcript; do not say "no recording" if a later/earlier call has one.
- "call X" with no message to relay → if X is in SAVED LISTS or THIS TURN names a list, use start_cold_batch — not start_target_call. Otherwise start_target_call (Jarvis personal assistant only).
- start_target_call dials one lead with tenants.vapi_assistant_id_jarvis ONLY.
- start_cold_batch queues a saved lead list. Pass source as the exact SAVED LISTS name. A LIVE script is always required. If they did not pick one, follow the tool instruction (ask to use the live script; if several, list live names). Never say all scripts are draft when list_scripts.live is non-empty. Never fall back to a default script. Count may be omitted — the whole list is used, capped at 200/day.
- NEVER place a call on the first ask. For lead calls: restate name + phone, ask: "Ready to call {Name} at {phone} — reply yes to place the Vapi call."
- For relays / new-contact relays: confirmation is handled after place_relay_call returns needs_confirmation — show the confirmationPrompt (name, number, task). Reply yes completes save (if new) + dial.
- For save_jarvis_contact: show confirmationPrompt; yes upserts jarvis_leads.
- Only call start_target_call after the user's latest message is an explicit yes/confirm/go ahead. For start_cold_batch you may call the tool on the first ask so it can return confirmationPrompt — show that verbatim and wait for yes before it will actually queue.
- For any script-invoked cold batch, require an explicit yes at any size. Show the confirmationPrompt verbatim (script name, version, published age, lead count, source, AED).
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

${savedListsPrompt || "SAVED LISTS: (unavailable this turn)"}

LIVE SNAPSHOT (recent WhatsApp threads — may be incomplete; use tools for deep lookup):
${liveContext || "(no recent conversations loaded)"}` + (runStatusBlock || "");
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

function matchSavedListFromMessages(lists, messages) {
  const history = normalizeMessages(messages);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role !== "user") continue;
    if (
      /^(yes|y|yeah|yep|confirm|confirmed|go ahead|do it|proceed|go)\b/i.test(
        history[i].content.trim()
      )
    ) {
      continue;
    }
    const hit = matchSavedList(lists, history[i].content);
    if (hit) return hit;
  }
  return null;
}

function formatScriptsPrompt(listed) {
  if (!listed) return "";
  const live = listed.live?.join(", ") || "(none)";
  const drafts = listed.drafts?.join(", ") || "none";
  return `LIVE SCRIPTS (may dial): ${live}. DRAFT (cannot dial): ${drafts}.`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function executeTool({
  name,
  input,
  tenantId,
  agentName,
  messages,
  senderPhone,
  listMatch,
}) {
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
    case "get_run_status":
      return getRunStatus(tenantId, input);
    case "get_unreplied_conversations":
      return getJarvisUnrepliedConversations(tenantId, input);
    case "get_inbox_activity":
      return getJarvisInboxActivity(tenantId, input);
    case "get_stale_conversations":
      return getJarvisStaleConversations(tenantId, input);
    case "get_inbox_stats":
      return getJarvisInboxStats(tenantId, input);
    case "list_scripts":
      return listScripts(tenantId);
    case "list_lead_sources":
      return listLeadSources(tenantId);
    case "set_lead_name":
      return setJarvisLeadName(tenantId, input);
    case "save_jarvis_contact":
      return saveJarvisContact({
        tenantId,
        senderPhone,
        name: input.name,
        phone: input.phone,
      });
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
      const source = String(input.source || "").trim() || listMatch?.name || "";
      const phrase = String(input.script || "").trim();
      if (!phrase) {
        return scriptRequiredPayload(tenantId, { source });
      }
      const countRaw = Number(input.count);
      const count =
        Number.isInteger(countRaw) && countRaw >= 1
          ? countRaw
          : Math.max(1, Number(listMatch?.count) || 200);
      const resolved = await resolveScript({ tenantId, phrase });
      if (!isResolvedMatch(resolved)) {
        return resolveFailurePayload(resolved);
      }
      const scriptConfirmed =
        latestUserAffirmed(messages) &&
        previousAssistantMentioned(messages, /go\?/i) &&
        previousAssistantMentioned(
          messages,
          new RegExp(escapeRegExp(resolved.match.display_name))
        );
      if (!scriptConfirmed) {
        return {
          requiresConfirmation: true,
          action: "cold_batch",
          count,
          confirmationPrompt: buildScriptBatchConfirm({
            resolved,
            count,
            sourceFilter: source,
          }),
          instruction:
            "Show the confirmationPrompt verbatim. Do not call the tool again this turn.",
        };
      }
      return startColdBatch(
        tenantId,
        count,
        agentName || "Jarvis",
        input.country,
        source,
        phrase
      );
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
  let savedLists = [];
  let listedScripts = null;
  try {
    const conversations = await getJarvisRecentConversations(tenantId, {
      limit: 5,
      messageLimit: 8,
    });
    liveContext = formatLiveContext(conversations);
  } catch (error) {
    console.error("[jarvis] live context unavailable:", error.message);
  }
  try {
    const supabase = getSupabaseServerClient();
    if (supabase) savedLists = await listSavedLists(supabase, tenantId);
  } catch (error) {
    console.error("[jarvis] saved lists unavailable:", error.message);
  }
  try {
    listedScripts = await listScripts(tenantId);
  } catch (error) {
    console.error("[jarvis] scripts unavailable:", error.message);
  }

  const client = new Anthropic({ apiKey });
  const conversation = normalizeMessages(messages);
  if (!conversation.length || conversation.at(-1).role !== "user") {
    throw new Error("A final user message is required");
  }

  const lastText = conversation.at(-1)?.content;
  if (isHelpMessage(lastText)) {
    return { text: HELP_TEXT, toolRounds: 0 };
  }

  const listMatch = matchSavedListFromMessages(savedLists, conversation);
  const namedList = matchSavedList(savedLists, lastText);
  let runStatusBlock = "";
  if (shouldPrefetchRunStatus(lastText, namedList)) {
    try {
      const runStatus = await getRunStatus(
        tenantId,
        namedList ? { list: namedList.name } : {}
      );
      runStatusBlock = formatRunStatusBlock(runStatus);
    } catch (error) {
      console.error("[jarvis] run status prefetch failed:", error.message);
      runStatusBlock = formatRunStatusBlock({
        found: false,
        instruction:
          "Run status lookup failed. Say you could not load the run. Do not invent numbers or send them to the Vapi dashboard.",
      });
    }
  }

  const savedListsPrompt = [
    formatSavedListsPrompt(savedLists, listMatch),
    formatScriptsPrompt(listedScripts),
  ]
    .filter(Boolean)
    .join("\n");

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1400,
      system: systemPrompt({
        liveContext,
        savedListsPrompt,
        agentName,
        runStatusBlock,
      }),
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
          listMatch,
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
      if (confirmation.action === "save_contact") {
        return {
          text:
            confirmation.confirmationPrompt ||
            formatContactConfirmation({
              name: confirmation.name,
              phone: confirmation.phone,
            }),
          toolRounds: round + 1,
        };
      }
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
          text:
            confirmation.confirmationPrompt ||
            `You’re about to start a cold batch of ${confirmation.count} Vapi calls. Reply “yes” to confirm.`,
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

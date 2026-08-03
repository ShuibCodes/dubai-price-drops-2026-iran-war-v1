import Anthropic from "@anthropic-ai/sdk";
import {
  countCallsSince,
  getCallDetail,
  getLeadStory,
  getPendingCallbacks,
  listLeads,
  listLeadSources,
  pauseTenant,
  queryLeads,
  resumeTenant,
  scheduleBatch,
  searchConversations,
  searchLeadByName,
  startColdBatch,
  startTargetCall,
  todaysDigest,
} from "./tools.js";

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 5;

export const copilotToolDefinitions = [
  {
    name: "count_calls_since",
    description:
      "Count outbound call outcomes since an ISO timestamp. Use for period totals and performance questions.",
    input_schema: {
      type: "object",
      properties: { sinceIso: { type: "string", description: "ISO-8601 timestamp" } },
      required: ["sinceIso"],
    },
  },
  {
    name: "todays_digest",
    description:
      "Get today's Dubai-time calling totals and up to five notable engaged calls.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "query_leads",
    description:
      "ROSTER tool: count and list leads on the tenant's lead list (imported/purchased contacts), regardless of whether they were ever called. Use for 'how many leads do I have', 'show me downtown leads', 'who is uncalled', or any question about the lead list itself. Returns total plus a page of leads with name, phone, source, and whether each was already called or queued.",
    input_schema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description:
            "Optional campaign/source filter, substring matched (e.g. 'downtown', 'burj lake').",
        },
        country: {
          type: "string",
          description:
            "Optional country filter: dialing code ('971') or name ('UAE', 'Saudi', 'UK').",
        },
        uncalledOnly: {
          type: "boolean",
          default: false,
          description: "Only leads never called and not currently queued.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 5 },
        offset: { type: "integer", minimum: 0, default: 0 },
      },
    },
  },
  {
    name: "list_lead_sources",
    description:
      "ROSTER tool: list this tenant's distinct lead campaign sources with counts (e.g. downtown_views, burj_lake_owner). Use when the user mentions a campaign vaguely or asks what lists they have.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_call_activity",
    description:
      "CALL ACTIVITY tool: list leads that have been CALLED, with outcomes and qualification. Use for questions about engaged/qualified leads, callbacks, or reviewing calls in a period. Never use this to count or list the lead roster — use query_leads for that.",
    input_schema: {
      type: "object",
      properties: {
        sinceIso: {
          type: "string",
          description: "Optional inclusive ISO-8601 start timestamp.",
        },
        untilIso: {
          type: "string",
          description: "Optional exclusive ISO-8601 end timestamp for a day or date range.",
        },
        engagedOnly: { type: "boolean", default: false },
        qualifiedOnly: { type: "boolean", default: false },
        outcome: {
          type: "string",
          description: "Optional exact qualification outcome, such as callback or qualified.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 5 },
        offset: { type: "integer", minimum: 0, default: 0 },
      },
    },
  },
  {
    name: "get_call_detail",
    description:
      "Fetch one call's details including the raw transcript. Use when the user asks what a specific person said or how a specific call went. READ the transcript and answer with a 1-5 line summary in your own words — what they wanted, key objections or reactions, budget/area/timing specifics, and how it ended. Report only supported, non-empty facts; never mention missing fields or infer why the call ended. NEVER paste the transcript itself into the reply.",
    input_schema: {
      type: "object",
      properties: {
        leadId: {
          type: "string",
          format: "uuid",
          description: "Fetch the lead's most recent call.",
        },
        callId: {
          type: "string",
          format: "uuid",
          description: "Fetch this exact call.",
        },
      },
    },
  },
  {
    name: "search_lead_by_name",
    description:
      "Fuzzy-search tenant leads by partial name or campaign source (e.g. 'Cesar' or 'downtown'). Use this before requesting one lead's full story or calling a named lead.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "get_lead_story",
    description:
      "Get one lead's chronological call history (summaries, outcomes, CRM notes). Requires a lead ID returned by lead or conversation search.",
    input_schema: {
      type: "object",
      properties: { leadId: { type: "string", format: "uuid" } },
      required: ["leadId"],
    },
  },
  {
    name: "get_pending_callbacks",
    description: "List leads whose latest call outcome is a callback with a callback time.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_conversations",
    description:
      "Search call transcripts. Use for questions about what a lead said on a call, then use get_lead_story or get_call_detail for full context.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "start_cold_batch",
    description:
      "Queue cold-list leads starting now at 60-second spacing. Re-dials previously called numbers until they have 3 prior call attempts; skips only leads already at 3+ attempts or currently queued. Subject to a 200 calls/day Dubai-day cap (no business-hours gating). More than 100 requires explicit user confirmation. Pass country and/or source to restrict the batch.",
    input_schema: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1 },
        country: {
          type: "string",
          description:
            "Optional country filter: a dialing code ('971') or name ('UAE', 'Saudi', 'UK'). Omit to call all countries.",
        },
        source: {
          type: "string",
          description:
            "Optional lead-source filter, substring matched (e.g. 'downtown', 'burj lake', 'purchased'). Omit to use the tenant's full cold list.",
        },
      },
      required: ["count"],
    },
  },
  {
    name: "start_target_call",
    description:
      "Call one tenant lead immediately (no business-hours delay). Requires a lead ID from search_lead_by_name.",
    input_schema: {
      type: "object",
      properties: { leadId: { type: "string", format: "uuid" } },
      required: ["leadId"],
    },
  },
  {
    name: "schedule_batch",
    description:
      "Schedule cold-list leads at 60-second spacing starting at whenIso. Re-dials previously called numbers until 3 prior attempts; skips 3+ attempts or currently queued. Subject to a 200 calls/day Dubai-day cap (no business-hours snapping). Set spreadDays to split evenly across N days. More than 100 total requires explicit yes. Pass country and/or source to restrict.",
    input_schema: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1 },
        whenIso: { type: "string", description: "ISO-8601 timestamp for the first call" },
        spreadDays: {
          type: "integer",
          minimum: 1,
          maximum: 14,
          description: "Spread count evenly across this many consecutive days (default 1)",
        },
        country: {
          type: "string",
          description:
            "Optional country filter: a dialing code ('971') or name ('UAE', 'Saudi', 'UK'). Omit to call all countries.",
        },
        source: {
          type: "string",
          description:
            "Optional lead-source filter, substring matched (e.g. 'downtown', 'burj lake', 'purchased'). Omit to use the tenant's full cold list.",
        },
      },
      required: ["count", "whenIso"],
    },
  },
  {
    name: "pause_tenant",
    description: "Pause all outbound calling for this tenant immediately.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "resume_tenant",
    description: "Resume outbound calling for this tenant.",
    input_schema: { type: "object", properties: {} },
  },
];

function systemPrompt(tenantName, agentName) {
  return `You are the operations Copilot for ${tenantName}.
You are assisting ${agentName || "a team member"}. Be concise, warm, and numbers-first.

Rules:
- Answer operational questions only from tool results. Never invent data.
- If a tool returns no rows or null, say that no matching data was found.
- Tenant identity is resolved by the server. Never ask for, infer, or pass a tenant ID.
- For write actions, briefly restate what you are doing and execute it in the same turn without asking for confirmation.
- Exception: before start_cold_batch or schedule_batch above 100 total calls, ask for an explicit yes. Do not execute until the user confirms.
- When discussing a specific lead, include their full phone number so the agent can reach them directly.
- Batches can be restricted to one market: when the user says "UAE leads only", "local numbers", "971 numbers", or names any country, pass that country to start_cold_batch or schedule_batch. UAE = 971. In the reply, state which country the batch was limited to.
- When batching a named campaign, pass it as source to start_cold_batch or schedule_batch. If unsure what campaigns exist, call list_lead_sources first.
- Dates/times are Asia/Dubai unless the user specifies otherwise. Daily dial cap is 200 calls per Dubai day. There is NO business-hours gate — evenings/weekends are fine as long as the day stays under 200.
- Cold batches re-call numbers that were dialed before. Only skip a lead once it already has 3 call attempts (or is already in the queue). Prefer never-called first, then 1x, then 2x.

ROSTER vs CALL ACTIVITY — hard routing rules:
- "leads", "my list", "how many leads", "uncalled", or any campaign/source question ("downtown leads", "burj lake owners") → ROSTER tools only: query_leads and list_lead_sources. Pass the campaign word as the source filter to query_leads.
- "calls", "today's activity", "outcomes", "callbacks", "engaged", "qualified", "what did they say" → CALL tools only: todays_digest, count_calls_since, list_call_activity, get_pending_callbacks, get_call_detail.
- NEVER use call tools to answer how many leads exist or to list the roster; call counts are not the lead list.
- After start_cold_batch or schedule_batch, the result includes queuedLeads with the exact people queued — list them from there instead of running another lookup.

ANSWERING ABOUT LEADS AND CALLS:
- Whenever the user asks about leads, calls, engagement, or qualification — even phrased as "how many" — answer with BOTH the headline numbers and a named breakdown of the FIRST 5 leads. Use the routing rules above to pick the roster or call tool; never answer with counts alone.
- Use a Markdown table ONLY for the numeric stat summary (the metric/count block). Never put leads or any non-numeric listing in a table; replies must stay readable on a phone screen.
- Format the lead breakdown as short bullets, one lead per line: name, then what they wanted (intent + budget + areas + timeline in one natural line), callback time if present, and distressed-deals interest if present.
- Build that one-line breakdown from the structured intent, budget, areas, timeline, callbackTime, and wantsDistressedDeals fields. Do not infer a callback time from the outcome, and do not add placeholders such as "no details captured", "callback pending", or "unknown"; if a field is empty, omit it.
- After the breakdown always add exactly: "Full details for every lead are on the CRM."
- If total is greater than the number shown, state how many more there are and offer the next batch.
- Specific person exception: when asked about one person or one lead, use search_lead_by_name and get_lead_story without the group-list cap. If asked for their broader story or history, give the relevant history. If asked what they said or how a call went, also use get_call_detail and follow the stricter specific-call rule below.
- Specific review-window exception: for a day or date range the user wants reviewed, call list_call_activity with both time bounds and limit 10.
- When summarising a specific call from its transcript, write 1-5 substantive lines covering what they wanted, notable objections or reactions, concrete budget/area/timing details, and the outcome. Quote at most one short telling phrase. Never paste or reproduce the transcript.
- If the request is specifically about one latest or identified call, the 1-5 line rule OVERRIDES the broader person-history guidance. The ENTIRE reply must be 1-5 lines about that call only.
- In a specific-call summary, mention only facts directly supported by non-empty tool fields or dialogue. It is forbidden to mention absent/uncaptured fields, infer why the call ended from missing data or a transcript stopping, discuss other calls, append an assessment or recommendation, or add the group-list CRM boilerplate.
- Never invent or embellish fields a tool did not return. Skip empty fields silently instead of saying they are unknown.
- For broader "what did anyone say about X?" searches, use search_conversations and then get_lead_story or get_call_detail for the identified lead. Do not claim access to any disk knowledge base.`;
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

function hasLargeBatchConfirmation(messages, count) {
  const history = normalizeMessages(messages);
  const latest = history.at(-1);
  const previous = history.at(-2);
  if (latest?.role !== "user" || previous?.role !== "assistant") return false;
  const affirmative = /^(yes|y|confirm|confirmed|go ahead|do it|proceed)\b/i.test(
    latest.content.trim()
  );
  const confirmationRequest =
    previous.content.includes(String(count)) &&
    /confirm|explicit yes|cold batch|calls/i.test(previous.content);
  return affirmative && confirmationRequest;
}

async function executeTool({ name, input, tenantId, agentName, messages }) {
  switch (name) {
    case "count_calls_since":
      return countCallsSince(tenantId, input.sinceIso);
    case "todays_digest":
      return todaysDigest(tenantId);
    case "list_call_activity":
      return listLeads(tenantId, input);
    case "query_leads":
      return queryLeads(tenantId, input);
    case "list_lead_sources":
      return listLeadSources(tenantId);
    case "get_call_detail":
      return getCallDetail(tenantId, input);
    case "search_lead_by_name":
      return searchLeadByName(tenantId, input.name);
    case "get_lead_story":
      // Copilot is client-facing: call activity only, never WhatsApp threads.
      return getLeadStory(tenantId, input.leadId, { includeMessages: false });
    case "get_pending_callbacks":
      return getPendingCallbacks(tenantId);
    case "search_conversations":
      return searchConversations(tenantId, input.query, { includeMessages: false });
    case "start_cold_batch":
      if (Number(input.count) > 100 && !hasLargeBatchConfirmation(messages, input.count)) {
        return {
          requiresConfirmation: true,
          count: Number(input.count),
          instruction: `Ask the user to explicitly confirm starting ${input.count} cold calls. Do not call the tool again this turn.`,
        };
      }
      return startColdBatch(tenantId, input.count, agentName, input.country, input.source);
    case "start_target_call":
      return startTargetCall(tenantId, input.leadId, agentName);
    case "schedule_batch":
      if (Number(input.count) > 100 && !hasLargeBatchConfirmation(messages, input.count)) {
        return {
          requiresConfirmation: true,
          count: Number(input.count),
          instruction: `Ask the user to explicitly confirm scheduling ${input.count} calls. Do not call the tool again this turn.`,
        };
      }
      return scheduleBatch(
        tenantId,
        input.count,
        input.whenIso,
        agentName,
        input.spreadDays,
        input.country,
        input.source
      );
    case "pause_tenant":
      return pauseTenant(tenantId, agentName);
    case "resume_tenant":
      return resumeTenant(tenantId, agentName);
    default:
      throw new Error(`Unknown Copilot tool: ${name}`);
  }
}

export async function runCopilotTurn({
  tenantId,
  tenantName,
  messages,
  agentName,
}) {
  if (!tenantId) throw new Error("Resolved tenant ID is required");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey });
  const conversation = normalizeMessages(messages);
  if (!conversation.length || conversation.at(-1).role !== "user") {
    throw new Error("A final user message is required");
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: systemPrompt(tenantName, agentName),
      tools: copilotToolDefinitions,
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
    let confirmationCount = null;
    for (const toolUse of toolUses) {
      try {
        const result = await executeTool({
          name: toolUse.name,
          input: toolUse.input || {},
          tenantId,
          agentName,
          messages,
        });
        if (result?.requiresConfirmation) confirmationCount = result.count;
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
    if (confirmationCount) {
      return {
        text: `You’re about to start a cold batch of ${confirmationCount} calls. Reply “yes” to confirm.`,
        toolRounds: round + 1,
      };
    }
    conversation.push({ role: "user", content: results });
  }

  throw new Error("Copilot exceeded the maximum of 5 tool rounds");
}

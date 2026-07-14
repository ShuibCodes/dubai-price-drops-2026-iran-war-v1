import Anthropic from "@anthropic-ai/sdk";
import {
  countCallsSince,
  getLeadStory,
  getPendingCallbacks,
  pauseTenant,
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
    name: "search_lead_by_name",
    description:
      "Fuzzy-search tenant leads by partial name. Use this before requesting one lead's full story or calling a named lead.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "get_lead_story",
    description:
      "Get one lead's chronological call and message history. Requires a lead ID returned by lead or conversation search.",
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
      "Search WhatsApp message bodies and call transcripts. Use for questions about what a lead said, then use get_lead_story for full context.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "start_cold_batch",
    description:
      "Start or queue calls to the next uncalled Purchased list leads, subject to daily cap and business hours. More than 100 requires explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: { count: { type: "integer", minimum: 1 } },
      required: ["count"],
    },
  },
  {
    name: "start_target_call",
    description:
      "Call one tenant lead now, or queue it for the next Dubai business window. Requires a lead ID from search_lead_by_name.",
    input_schema: {
      type: "object",
      properties: { leadId: { type: "string", format: "uuid" } },
      required: ["leadId"],
    },
  },
  {
    name: "schedule_batch",
    description:
      "Schedule calls to the next uncalled Purchased list leads at 60-second spacing, subject to the daily cap.",
    input_schema: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1 },
        whenIso: { type: "string", description: "ISO-8601 timestamp" },
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
- For "what did X say?" and similar questions, use search_conversations and then get_lead_story when a lead is identified. Do not claim access to any disk knowledge base.
- For write actions, briefly restate what you are doing and execute it in the same turn without asking for confirmation.
- Exception: before start_cold_batch above 100 calls, ask for an explicit yes. Do not execute until the user confirms.
- Phone values are deliberately masked. Do not ask tools to reveal full numbers.
- Dates and business hours are Asia/Dubai unless the user specifies otherwise.`;
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
    case "search_lead_by_name":
      return searchLeadByName(tenantId, input.name);
    case "get_lead_story":
      return getLeadStory(tenantId, input.leadId);
    case "get_pending_callbacks":
      return getPendingCallbacks(tenantId);
    case "search_conversations":
      return searchConversations(tenantId, input.query);
    case "start_cold_batch":
      if (Number(input.count) > 100 && !hasLargeBatchConfirmation(messages, input.count)) {
        return {
          requiresConfirmation: true,
          count: Number(input.count),
          instruction: `Ask the user to explicitly confirm starting ${input.count} cold calls. Do not call the tool again this turn.`,
        };
      }
      return startColdBatch(tenantId, input.count, agentName);
    case "start_target_call":
      return startTargetCall(tenantId, input.leadId, agentName);
    case "schedule_batch":
      return scheduleBatch(tenantId, input.count, input.whenIso, agentName);
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

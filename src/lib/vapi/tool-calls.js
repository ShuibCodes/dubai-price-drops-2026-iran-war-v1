/**
 * Parse Vapi server tool-call webhooks.
 *
 * Format from https://docs.vapi.ai/tools/custom-tools.mdx and
 * https://docs.vapi.ai/server-url/events.mdx — do not invent other shapes.
 *
 * Request: { message: { type: "tool-calls", call, toolCallList, toolWithToolCallList } }
 * Response: { results: [{ toolCallId, result }] } or { toolCallId, error }
 * result/error must be single-line strings. Always HTTP 200.
 */

export function isVapiToolCallsMessage(payload) {
  const type = payload?.message?.type || payload?.type;
  return type === "tool-calls";
}

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

function fromToolCallListItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  const name = String(item.name || item.function?.name || "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    arguments: asObject(
      item.arguments || item.parameters || item.function?.arguments || item.function?.parameters
    ),
  };
}

function fromToolWithToolCall(item) {
  if (!item || typeof item !== "object") return null;
  const toolCall = item.toolCall || {};
  const id = String(toolCall.id || "").trim();
  const name = String(
    item.name || toolCall.function?.name || toolCall.name || ""
  ).trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    arguments: asObject(
      toolCall.function?.parameters ||
        toolCall.parameters ||
        toolCall.function?.arguments
    ),
  };
}

/**
 * Official primary list is message.toolCallList.
 * Fallback is message.toolWithToolCallList[].toolCall (same docs page).
 */
export function extractVapiToolCalls(payload) {
  const message = payload?.message ?? payload ?? {};
  const primary = Array.isArray(message.toolCallList) ? message.toolCallList : [];
  const fromPrimary = primary.map(fromToolCallListItem).filter(Boolean);
  if (fromPrimary.length) return fromPrimary;

  const nested = Array.isArray(message.toolWithToolCallList)
    ? message.toolWithToolCallList
    : [];
  return nested.map(fromToolWithToolCall).filter(Boolean);
}

export function extractVapiToolCallContext(payload) {
  const message = payload?.message ?? payload ?? {};
  const call = message.call || payload?.call || {};
  return {
    callId: String(call.id || message.callId || payload?.callId || "").trim() || null,
    metadata:
      call.metadata && typeof call.metadata === "object" ? call.metadata : {},
  };
}

function oneLine(value) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/[\r\n]+/g, " ").trim();
}

export function vapiToolSuccess(toolCallId, result) {
  return { toolCallId, result: oneLine(result) };
}

export function vapiToolError(toolCallId, error) {
  return { toolCallId, error: oneLine(error) };
}

export function vapiToolCallsResponse(results) {
  return { results: Array.isArray(results) ? results : [] };
}

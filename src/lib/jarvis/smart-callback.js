import {
  parseBatchCallbackCommand,
  searchBatchCallbackCandidates,
} from "@/lib/jarvis/batch-callback-search";

/**
 * List-shaped Smart Callback asks from WhatsApp.
 * Requires a callback verb + a group noun so lookups like "who mentioned a budget?"
 * and saved-list commands like "call my downtown list" stay on existing Jarvis paths.
 */
const SMART_CALLBACK_REQUEST_RE =
  /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:call|ring|dial|find|list|get|show)(?:\s+me)?\s+(?:all(?:\s+of)?\s+)?(?:(?:the|my)\s+)?(?:everyone|anyone|anybody|people|contacts|leads|them)\b/i;

function latestUserText(messages) {
  const history = Array.isArray(messages) ? messages : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row?.role === "user") return String(row.content || "").trim();
  }
  return "";
}

export function isSmartCallbackRequest(text) {
  return SMART_CALLBACK_REQUEST_RE.test(String(text || "").trim());
}

function emptySearchResult({ intent, windowDays }) {
  return {
    intent: String(intent || "").trim() || "(empty)",
    windowDays: Number(windowDays) || 21,
    since: null,
    scannedMessageRows: 0,
    threadsConsidered: 0,
    threadsEvaluated: 0,
    matchLimit: 0,
    matches: [],
    model: null,
    stoppedEarly: false,
  };
}

export function formatSmartCallbackMatches({
  intent,
  windowDays,
  since,
  matches = [],
  threadsEvaluated,
  threadsConsidered,
}) {
  const header =
    `I checked your WhatsApp conversations for: "${intent}" ` +
    `(last ${windowDays} days).`;

  if (!Array.isArray(matches) || matches.length === 0) {
    const scanned =
      Number.isFinite(threadsEvaluated) || Number.isFinite(threadsConsidered)
        ? ` I reviewed ${Number(threadsEvaluated) || 0} of ${Number(threadsConsidered) || 0} active threads.`
        : "";
    const sinceText = since ? ` (since ${String(since).slice(0, 10)})` : "";
    return `${header} I couldn't find any matching leads${sinceText}.${scanned}`;
  }

  const rows = matches.slice(0, 20).map((lead, index) => {
    const name = lead.display_name || "Unknown";
    const phone = lead.phone_e164 || lead.wa_id || "unknown phone";
    const reason = lead.match_reason ? ` — ${lead.match_reason}` : "";
    return `${index + 1}. ${name} (${phone})${reason}`;
  });

  const tail =
    matches.length > 20
      ? `\n…and ${matches.length - 20} more matches.`
      : "";
  const coverage =
    Number.isFinite(threadsEvaluated) || Number.isFinite(threadsConsidered)
      ? `\n\nScanned ${Number(threadsEvaluated) || 0} of ${Number(threadsConsidered) || 0} active threads.`
      : "";

  return `${header}\n\n${rows.join("\n")}${tail}${coverage}`;
}

/**
 * Smart callback list routing for real WhatsApp agent messages.
 * Returns null when this turn is not a smart-callback request.
 *
 * Uses the Jarvis turn's agentId (already scoped). Fail closed if that id is missing.
 * Console /api/jarvis/chat with no senderPhone stays on the existing tool path.
 */
export async function maybeHandleSmartCallbackRequest({
  tenantId,
  agentId,
  messages,
  senderPhone,
  listMatch = null,
  parseCommand = parseBatchCallbackCommand,
  searchCandidates = searchBatchCallbackCandidates,
}) {
  const text = latestUserText(messages);
  if (!text) return null;
  if (!senderPhone) return null;
  if (listMatch && !isSmartCallbackRequest(text)) return null;
  if (!isSmartCallbackRequest(text)) return null;

  const parsed = parseCommand(text);
  if (!tenantId || !agentId) {
    const result = emptySearchResult(parsed);
    return {
      handled: true,
      parsed,
      result,
      failClosed: true,
      text: formatSmartCallbackMatches(result),
    };
  }

  const result = await searchCandidates({
    tenantId,
    agentId,
    intent: parsed.intent,
    windowDays: parsed.windowDays,
  });

  return {
    handled: true,
    parsed,
    result,
    agentId,
    text: formatSmartCallbackMatches(result),
  };
}

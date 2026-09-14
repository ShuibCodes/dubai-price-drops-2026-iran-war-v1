import {
  parseBatchCallbackCommand,
  searchBatchCallbackCandidates,
} from "@/lib/jarvis/batch-callback-search";
import { resolveJarvisSender } from "@/lib/jarvis/resolve-sender";

const SMART_CALLBACK_REQUEST_RE =
  /^(?:please\s+)?(?:can you\s+)?(?:call|ring|dial|find|list|get|show)\s+(?:everyone|anyone|anybody|people|contacts|leads|them)\b/i;

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
 * Resolve the requesting agent for a Smart Callback turn.
 * Must belong to the supplied tenantId. Fail closed otherwise.
 */
export async function resolveSmartCallbackAgent({
  tenantId,
  senderPhone,
  resolveSender = resolveJarvisSender,
} = {}) {
  if (!tenantId || !senderPhone) return null;
  const sender = await resolveSender(senderPhone);
  if (!sender?.agentId || !sender?.tenantId) return null;
  if (String(sender.tenantId) !== String(tenantId)) return null;
  return sender;
}

/**
 * Smart callback list routing for real WhatsApp agent messages.
 * Returns null when this turn is not a smart-callback request.
 *
 * Fail closed: unknown / cross-tenant senders never run the lead search.
 */
export async function maybeHandleSmartCallbackRequest({
  tenantId,
  messages,
  senderPhone,
  listMatch = null,
  parseCommand = parseBatchCallbackCommand,
  searchCandidates = searchBatchCallbackCandidates,
  resolveSender = resolveJarvisSender,
}) {
  const text = latestUserText(messages);
  if (!text) return null;
  // Keep smart-callback logic on the real agent-owned WhatsApp path.
  if (!senderPhone) return null;
  // Explicit saved-list commands stay on the existing list / cold-batch path.
  // Smart-callback-shaped text ("call everyone who …") must not be blocked by a
  // weak substring list hit (e.g. list named "budget" inside "mentioned a budget").
  if (listMatch && !isSmartCallbackRequest(text)) return null;
  if (!isSmartCallbackRequest(text)) return null;

  const parsed = parseCommand(text);
  const agent = await resolveSmartCallbackAgent({
    tenantId,
    senderPhone,
    resolveSender,
  });

  if (!agent) {
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
    agentId: agent.agentId,
    intent: parsed.intent,
    windowDays: parsed.windowDays,
  });

  return {
    handled: true,
    parsed,
    result,
    agentId: agent.agentId,
    text: formatSmartCallbackMatches(result),
  };
}

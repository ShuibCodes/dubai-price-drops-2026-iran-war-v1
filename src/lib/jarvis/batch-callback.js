/** Max lines shown before "+ N more". Keeps preview WhatsApp-friendly. */
const PREVIEW_LINE_CAP = 12;

const WHATSAPP_BODY_MAX = 1500;

function cleanLine(value, max = 120) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function formatWindowLabel(windowDays) {
  const days = Number(windowDays);
  if (!Number.isFinite(days) || days <= 0) return "";
  if (days === 1) return " in the last day";
  if (days === 7) return " in the last week";
  if (days === 30) return " in the last month";
  return ` in the last ${days} days`;
}

function formatLeadLine(index, match) {
  const name = cleanLine(match.display_name, 40) || "Unknown";
  const phone = cleanLine(match.phone_e164, 24);
  const who = phone ? `${name} (${phone})` : name;
  const reason = cleanLine(match.match_reason, 100);
  const detail = reason ? ` — ${reason}` : "";
  return `${index}. ${who}${detail}`;
}

function truncateMiddleAtBoundary(middle, header, maxLen) {
  if (middle.length <= maxLen) {
    return { middle, truncated: false };
  }

  let cut = middle.slice(0, maxLen);
  const lastNl = cut.lastIndexOf("\n");
  if (lastNl > header.length) {
    cut = cut.slice(0, lastNl);
  } else {
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > header.length) {
      cut = cut.slice(0, lastSpace);
    }
  }

  return { middle: cut.replace(/\s+$/, ""), truncated: true };
}

/**
 * WhatsApp preview for a Smart Callback List — same plain, direct tone as
 * formatRelayConfirmation() in relay.js.
 *
 * Accepts the return value of searchBatchCallbackCandidates() or
 * { intent, windowDays?, matches }.
 *
 * @param {{
 *   intent: string,
 *   windowDays?: number,
 *   matches?: Array<{
 *     jarvis_lead_id?: string,
 *     display_name?: string,
 *     phone_e164?: string | null,
 *     match_reason?: string,
 *   }>,
 * }} searchResult
 * @returns {string}
 */
export function formatBatchCallbackPreview(searchResult) {
  const intent = cleanLine(searchResult?.intent, 200);
  const windowDays = searchResult?.windowDays;
  const matches = Array.isArray(searchResult?.matches) ? searchResult.matches : [];
  const windowLabel = formatWindowLabel(windowDays);
  const quotedIntent = intent ? `"${intent}"` : "your search";

  if (!matches.length) {
    return `No contacts matched ${quotedIntent}${windowLabel}. Try a different search or widen the window.`;
  }

  const count = matches.length;
  const countLabel = count === 1 ? "1 contact" : `${count} contacts`;
  const header = `Found ${countLabel}${windowLabel} matching ${quotedIntent}:`;

  const footer =
    count === 1
      ? "Reply yes to queue a callback call, or no to cancel."
      : `Reply yes to queue ${count} callback calls, or no to cancel.`;
  const footerBlock = `\n\n${footer}`;
  const truncatedNote = "\n\n(truncated — ask to see more)";

  function buildMiddle(visibleCount) {
    const visible = matches.slice(0, visibleCount);
    const lines = visible.map((match, index) => formatLeadLine(index + 1, match));
    const hidden = count - visibleCount;
    const parts = [header, "", ...lines];
    if (hidden > 0) {
      parts.push("", `(+ ${hidden} more)`);
    }
    return parts.join("\n");
  }

  let visibleCount = Math.min(count, PREVIEW_LINE_CAP);
  while (visibleCount >= 1) {
    const middle = buildMiddle(visibleCount);
    const full = `${middle}${footerBlock}`;
    if (full.length <= WHATSAPP_BODY_MAX) {
      return full;
    }

    const { middle: trimmed, truncated } = truncateMiddleAtBoundary(
      middle,
      header,
      WHATSAPP_BODY_MAX - footerBlock.length - truncatedNote.length
    );
    const withNote = `${trimmed}${truncated ? truncatedNote : ""}${footerBlock}`;
    if (withNote.length <= WHATSAPP_BODY_MAX) {
      return withNote;
    }

    visibleCount -= 1;
  }

  return `${header}${truncatedNote}${footerBlock}`;
}

/**
 * Parse a single WhatsApp .txt export into one KB document shape.
 *
 * Dates/times use the JavaScript Date local constructor, then `.toISOString()`
 * (`firstMessageAt` / `lastMessageAt`).
 *
 * @param {string} fileContent - Full file contents (UTF-8 string).
 * @param {string} agentId - Agent / tenant id supplied by caller.
 * @param {object} [options={}]
 * @param {string} [options.id] - Stable document id; falls back from filename or default.
 * @param {string} [options.filename] - Original filename (used when options.id missing).
 * @param {string} [options.source] - Source label (default `"whatsapp"`).
 * @returns {Array<{
 *   id: string,
 *   agentId: string,
 *   source: string,
 *   participants: string[],
 *   messages: Array<{ timestamp: string, at: string | null, sender: string, text: string }>,
 *   rawContent: string,
 *   messageCount: number,
 *   firstMessageAt: string | null,
 *   lastMessageAt: string | null
 * }>}
 */
export function parseWhatsAppExport(fileContent, agentId, options = {}) {
  const source =
    typeof options.source === "string" && options.source.trim()
      ? options.source.trim()
      : "whatsapp";

  const rawContent = stripBom(
    fileContent == null ? "" : String(fileContent),
  );

  const id =
    typeof options.id === "string" && options.id.trim()
      ? options.id.trim()
      : typeof options.filename === "string"
        ? `whatsapp-${slugFromFilename(options.filename)}`
        : "whatsapp-unknown";

  const lines = rawContent.replace(/\r\n/g, "\n").split("\n");

  /** @type {{ timestamp: string, at: string | null, sender: string, text: string }[]} */
  const messages = [];

  /** @type {Set<string>} */
  const participantSet = new Set();

  /** Leading lines before any message header merge into first message text. */
  const preambleLines = [];

  /** @type {{ sender: string, textParts: string[], at: string | null, timestamp: string } | null} */
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const header = parseMessageHeader(line);
    if (header) {
      if (current) {
        pushCurrentMessage(messages, current);
      }

      const preamble =
        preambleLines.length > 0 ? `${preambleLines.join("\n")}\n` : "";
      preambleLines.length = 0;

      current = {
        sender: normalizeSender(header.sender),
        textParts: [preamble + header.body.replace(/\s+$/, "")],
        at: toIso(header.date, header.timeWithSeconds),
        timestamp: header.timestamp,
      };
      participantSet.add(current.sender);
      continue;
    }

    const segment = line == null ? "" : line.replace(/\s+$/, "");
    if (!current) {
      if (segment.trim()) preambleLines.push(segment);
      continue;
    }

    current.textParts.push(segment);
  }

  if (current) {
    pushCurrentMessage(messages, current);
  }

  const timestamps = messages
    .map((m) => m.at)
    .filter((ts) => typeof ts === "string");

  const firstMessageAt =
    timestamps.length === 0
      ? null
      : timestamps.reduce((min, t) => (t < min ? t : min), timestamps[0]);
  const lastMessageAt =
    timestamps.length === 0
      ? null
      : timestamps.reduce((max, t) => (t > max ? t : max), timestamps[0]);

  return [
    {
      id,
      agentId:
        typeof agentId === "string"
          ? agentId
          : agentId != null
            ? String(agentId)
            : "",
      source,
      participants: [...participantSet].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
      messages,
      rawContent,
      messageCount: messages.length,
      firstMessageAt,
      lastMessageAt,
    },
  ];
}

const UTF8_BOM = "\uFEFF";

/** @param {string} content */
function stripBom(content) {
  return content.startsWith(UTF8_BOM) ? content.slice(1) : content;
}

/**
 * [DD/MM/YYYY, HH:MM:SS] Sender: body
 * Seconds optional on the clock.
 */
const HEADER_BRACKET =
  /^\[(\d{2}\/\d{2}\/\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s([^:]+):\s*(.*)$/;

/**
 * DD/MM/YYYY, HH:MM - Sender: body
 * Seconds optional on the clock.
 */
const HEADER_DASH =
  /^(\d{2}\/\d{2}\/\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+):\s*(.*)$/;

/**
 * @param {string} line
 * @returns {{ date: string, timeWithSeconds: string, timestamp: string, sender: string, body: string } | null}
 */
function parseMessageHeader(line) {
  let m = line.match(HEADER_BRACKET);
  if (!m) m = line.match(HEADER_DASH);
  if (!m) return null;

  const date = m[1];
  const timeRaw = m[2];

  return {
    date,
    timeWithSeconds: ensureSeconds(timeRaw),
    timestamp: `${date}, ${timeRaw}`,
    sender: m[3].trim(),
    body: m[4] ?? "",
  };
}

/** @param {string} time "H:MM", "HH:MM", or "HH:MM:SS" */
function ensureSeconds(time) {
  const parts = time.split(":");
  if (parts.length === 2) return `${time}:00`;
  return time;
}

/** @param {string} sender */
function normalizeSender(sender) {
  return sender
    .replace(/\s*\(Sterling Boulevard\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} date DD/MM/YYYY
 * @param {string} time HH:MM:SS
 * @returns {string | null}
 */
function toIso(date, time) {
  const [dayStr, monthStr, yearStr] = date.split("/");
  const [hStr, mStr, sStr] = time.split(":");
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);
  const hour = Number(hStr);
  const minute = Number(mStr);
  const second = Number(sStr);
  const d = new Date(year, month - 1, day, hour, minute, second);
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d.toISOString();
}

/**
 * @param {Array<{ timestamp: string, at: string | null, sender: string, text: string }>} messagesOut
 * @param {{ sender: string, textParts: string[], at: string | null, timestamp: string }} bub
 */
function pushCurrentMessage(messagesOut, bub) {
  messagesOut.push({
    timestamp: bub.timestamp,
    at: bub.at,
    sender: bub.sender,
    text: bub.textParts.join("\n"),
  });
}

/** @param {string} filename */
function slugFromFilename(filename) {
  const base =
    typeof filename !== "string"
      ? ""
      : filename.replace(/\\/g, "/").split("/").pop();

  const withoutExt =
    typeof base === "string" && base.includes(".")
      ? base.slice(0, base.lastIndexOf("."))
      : base;

  const trimmed = (withoutExt ?? "").trim() || "unknown";
  let slug = trimmed
    .normalize("NFKC")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return slug || "unknown";
}

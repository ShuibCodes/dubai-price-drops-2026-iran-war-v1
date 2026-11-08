const MAX_BODY_LENGTH = 1500;
const TRUNCATION_TAIL = "\n\n(truncated — ask for more)";

export function sendblueConfigured() {
  return Boolean(
    process.env.SENDBLUE_API_KEY_ID &&
    process.env.SENDBLUE_API_SECRET_KEY
  );
}

/**
 * Strips heading marks and whitespace-bounded **bold** for clean chat reading.
 */
export function plainJarvisIMessageText(text) {
  return String(text || "")
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/(^|[\s([(])\*\*([^*\n]+?)\*\*(?=$|[\s)\].,!?;:])/g, "$1$2");
}

function lastSentenceEnd(text) {
  let end = -1;
  for (const match of text.matchAll(/[.!?](?=\s|$)/g)) {
    end = match.index + 1;
  }
  return end;
}

export function truncateIMessageBody(text) {
  const body = String(text || "").trim();
  if (body.length <= MAX_BODY_LENGTH) return body;

  const budget = MAX_BODY_LENGTH - TRUNCATION_TAIL.length;
  const window = body.slice(0, budget);
  const sentenceEnd = lastSentenceEnd(window);
  let cut = "";
  if (sentenceEnd > 0) {
    cut = window.slice(0, sentenceEnd).trimEnd();
  } else {
    const space = Math.max(
      window.lastIndexOf(" "),
      window.lastIndexOf("\n"),
      window.lastIndexOf("\t")
    );
    if (space > 0) cut = window.slice(0, space).trimEnd();
  }

  if (!cut) return TRUNCATION_TAIL.trim();
  return `${cut}${TRUNCATION_TAIL}`;
}

/**
 * Send an iMessage via Sendblue REST API.
 * `to` is the recipient E.164 phone number.
 * `from` defaults to process.env.SENDBLUE_NUMBER.
 */
export async function sendIMessageText({ to, from, body }) {
  if (!sendblueConfigured()) {
    throw new Error("SENDBLUE_API_KEY_ID or SENDBLUE_API_SECRET_KEY not configured");
  }

  const text = truncateIMessageBody(body);
  if (!text) {
    throw new Error("Refusing to send empty iMessage body");
  }

  const recipient = String(to || "").trim();
  if (!recipient) {
    throw new Error("Recipient number is required");
  }

  const fromNumber = from || process.env.SENDBLUE_NUMBER;

  const payload = {
    number: recipient,
    content: text,
  };
  if (fromNumber) {
    payload.from_number = fromNumber;
  }

  const response = await fetch("https://api.sendblue.co/api/send-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "sb-api-key-id": process.env.SENDBLUE_API_KEY_ID,
      "sb-api-secret-key": process.env.SENDBLUE_API_SECRET_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Sendblue API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

import twilio from "twilio";

const MAX_BODY_LENGTH = 1500;
const TRUNCATION_TAIL = "\n\n(truncated — ask for more)";

export function twilioRestConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/**
 * Jarvis model replies only. Strips heading marks and whitespace-bounded **bold**.
 * Does not rewrite ** that sits inside an id or other token.
 */
export function plainJarvisWhatsAppText(text) {
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

export function truncateWhatsAppBody(text) {
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
 * Send a WhatsApp text via Twilio REST (async reply path).
 * `to` / `from` should be webhook values like `whatsapp:+971...`.
 */
export async function sendWhatsAppText({ to, from, body }) {
  if (!twilioRestConfigured()) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not configured");
  }
  const text = truncateWhatsAppBody(body);
  if (!text) {
    throw new Error("Refusing to send empty WhatsApp body");
  }
  if (!to || !from) {
    throw new Error("WhatsApp to/from are required");
  }

  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  return client.messages.create({
    from,
    to,
    body: text,
  });
}

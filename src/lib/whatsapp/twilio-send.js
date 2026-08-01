import twilio from "twilio";

const MAX_BODY_LENGTH = 1500;

export function twilioRestConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export function truncateWhatsAppBody(text) {
  const body = String(text || "").trim();
  if (body.length <= MAX_BODY_LENGTH) return body;
  const tail = "\n\n(truncated — ask for more)";
  return `${body.slice(0, MAX_BODY_LENGTH - tail.length)}${tail}`;
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

const RESEND_API_URL = "https://api.resend.com/emails";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function ensureCleanEmailBody(body) {
  const normalized = String(body ?? "")
    .replace(/—/g, "-")
    .replace(/\r/g, "")
    .trim();
  return normalized;
}

export async function sendLeadEmail({ to, subject, text, metadata: _metadata = {} }) {
  const apiKey = getRequiredEnv("RESEND_API_KEY");
  const from = getRequiredEnv("RESEND_FROM_EMAIL");

  if (!to || !subject || !text) {
    throw new Error("Missing required email payload fields");
  }

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject: String(subject).trim(),
    text: ensureCleanEmailBody(text),
    // Keep payload minimal for reliability across Resend accounts.
    // Metadata is accepted by this function for internal tracing, but is not sent as tags.
  };

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Resend returned non-JSON response (${response.status})`);
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Resend error (${response.status})`;
    throw new Error(message);
  }

  return data;
}

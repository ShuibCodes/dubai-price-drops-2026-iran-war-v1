const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";

/**
 * Pull the bare email from "Display Name <addr@domain>" or a plain address.
 */
export function parseFromAddress(fromAddress) {
  const raw = String(fromAddress || "").trim();
  if (!raw) return "";
  const angle = raw.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  return raw.toLowerCase();
}

/**
 * Gmail sends forwarding confirmation to the destination inbox when an agent
 * adds "Forward a copy to" in Gmail settings.
 */
export function isGmailForwardingVerification({ fromAddress }) {
  const email = parseFromAddress(fromAddress);
  return email === GMAIL_FORWARDING_SENDER;
}

/**
 * Gmail forwarding confirmation codes are numeric (often 9 digits). They may
 * appear in the subject as "(#123456789) Gmail Forwarding Confirmation…" and
 * in the body near phrases like "confirmation code".
 *
 * TODO: Revisit these patterns once we capture a real forwarding-noreply@google.com
 * message in production — layout and wording can change.
 */
export function extractGmailVerificationCode({ rawText, subject }) {
  const subjectStr = String(subject || "");
  const bodyStr = String(rawText || "");
  const combined = `${subjectStr}\n${bodyStr}`;

  const patterns = [
    /\(#\s*(\d{6,12})\s*\)/,
    /(?:confirmation|verify|verification)\s+code[:\s]+(\d{6,12})/i,
    /enter(?:\s+this)?\s+code(?:\s+in[^:\n]*)?[:\s]+(\d{6,12})/i,
    /code[:\s]+(\d{6,12})\b/i,
    /Gmail Forwarding Confirmation[^\d]*(\d{6,12})/i,
  ];

  for (const re of patterns) {
    const match = combined.match(re);
    if (match?.[1]) return match[1];
  }

  return null;
}

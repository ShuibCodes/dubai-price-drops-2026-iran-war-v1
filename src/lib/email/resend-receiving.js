import crypto from "crypto";
import { timingSafeEqual } from "@/lib/security/timing-safe";

const MAX_SKEW_SEC = 5 * 60;
const RECEIVING_API = "https://api.resend.com/emails/receiving";

function header(headers, name) {
  if (!headers) return "";
  const lower = name.toLowerCase();
  if (typeof headers.get === "function") {
    return String(headers.get(name) || headers.get(lower) || "").trim();
  }
  return String(headers[name] || headers[lower] || "").trim();
}

function decodeWebhookSecret(secret) {
  const raw = String(secret || "").trim();
  if (!raw) return null;
  if (raw.startsWith("whsec_")) {
    try {
      return Buffer.from(raw.slice("whsec_".length), "base64");
    } catch {
      return null;
    }
  }
  return Buffer.from(raw, "utf8");
}

export function signResendWebhookPayload(
  payload,
  secret,
  { id = "msg_test", timestamp = String(Math.floor(Date.now() / 1000)) } = {}
) {
  const key = decodeWebhookSecret(secret);
  if (!key?.length) throw new Error("Cannot sign without a webhook secret");
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const digest = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    id,
    timestamp,
    signature: `v1,${digest}`,
    body,
  };
}

/**
 * Svix-compatible verification for Resend webhooks.
 * Fail closed: missing secret, missing headers, skew, or bad signature → false.
 */
export function verifyResendWebhookSignature({
  rawBody,
  headers,
  secret = process.env.RESEND_WEBHOOK_SECRET,
  nowSec = Math.floor(Date.now() / 1000),
} = {}) {
  const key = decodeWebhookSecret(secret);
  if (!key?.length) return false;

  const id = header(headers, "svix-id") || header(headers, "webhook-id");
  const timestamp =
    header(headers, "svix-timestamp") || header(headers, "webhook-timestamp");
  const signature =
    header(headers, "svix-signature") || header(headers, "webhook-signature");
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Number(nowSec) - ts) > MAX_SKEW_SEC) return false;

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${String(rawBody ?? "")}`)
    .digest("base64");

  let matched = false;
  for (const part of String(signature).split(/\s+/).filter(Boolean)) {
    const comma = part.indexOf(",");
    const candidate = comma === -1 ? part : part.slice(comma + 1);
    if (timingSafeEqual(candidate, expected)) matched = true;
  }
  return matched;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * GET /emails/receiving/:id — webhook payloads do not include the body.
 * Returns plain text (or stripped HTML). Never logs the API key.
 */
export async function fetchReceivedEmail(
  emailId,
  { apiKey = process.env.RESEND_API_KEY, fetchImpl = fetch } = {}
) {
  const id = String(emailId || "").trim();
  if (!id) return null;
  if (!apiKey) {
    console.error("[dubizzle] receiving fetch skipped: API key not configured");
    return null;
  }

  const response = await fetchImpl(`${RECEIVING_API}/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!response.ok) {
    console.error(`[dubizzle] receiving fetch failed status=${response.status}`);
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    console.error("[dubizzle] receiving fetch returned non-JSON");
    return null;
  }

  const text = String(data?.text || "").trim();
  if (text) return text;
  const html = stripHtml(data?.html);
  return html || null;
}

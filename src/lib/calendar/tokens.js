import crypto from "crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_HEX_LENGTH = 64;

function getCalendarTokenKey() {
  const raw = String(process.env.CALENDAR_TOKEN_KEY || "").trim();
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length !== KEY_HEX_LENGTH) {
    throw new Error(
      "CALENDAR_TOKEN_KEY must be 32 bytes as 64 hex characters (openssl rand -hex 32)"
    );
  }
  return Buffer.from(raw, "hex");
}

function assertTokenPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Calendar token payload is required");
  }
  const refreshToken = String(payload.refresh_token || "").trim();
  if (!refreshToken) {
    throw new Error("refresh_token is required");
  }
  return {
    refresh_token: refreshToken,
    access_token: payload.access_token
      ? String(payload.access_token).trim()
      : null,
    expires_at: payload.expires_at != null ? String(payload.expires_at) : null,
    token_type: payload.token_type ? String(payload.token_type) : "Bearer",
    scope: payload.scope ? String(payload.scope) : null,
  };
}

/**
 * Encrypt Google OAuth tokens for calendar_connections.token_ciphertext.
 * Never log the result's contents or the plaintext payload.
 */
export function encryptCalendarTokens(payload) {
  const normalized = assertTokenPayload(payload);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getCalendarTokenKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(normalized), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptCalendarTokens(ciphertext) {
  const parts = String(ciphertext || "").split(".");
  if (parts[0] !== VERSION || parts.length !== 4) {
    throw new Error("Invalid calendar token ciphertext");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const data = Buffer.from(parts[3], "base64url");
  if (iv.length !== IV_BYTES || !tag.length || !data.length) {
    throw new Error("Invalid calendar token ciphertext");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getCalendarTokenKey(),
    iv
  );
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
  return assertTokenPayload(JSON.parse(json));
}

/** Safe API / Vapi shape. Never includes ciphertext or raw tokens. */
export function publicCalendarConnection(row) {
  if (!row) return null;
  return {
    id: row.id || null,
    tenantId: row.tenant_id || row.tenantId || null,
    agentId: row.agent_id || row.agentId || null,
    provider: row.provider || "google",
    email: row.google_account_email || row.email || null,
    calendarId: row.calendar_id || row.calendarId || "primary",
    calendarSummary: row.calendar_summary || row.calendarSummary || null,
    calendarTimezone: row.calendar_timezone || row.calendarTimezone || null,
    status: row.status || null,
    connectedAt: row.connected_at || row.connectedAt || null,
  };
}

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const STATE_VERSION = 1;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function getStateSecret() {
  const secret = String(
    process.env.CALENDAR_OAUTH_STATE_SECRET ||
      process.env.COPILOT_SESSION_SECRET ||
      ""
  ).trim();
  if (!secret) {
    throw new Error("COPILOT_SESSION_SECRET is not configured");
  }
  return secret;
}

function sign(body) {
  return createHmac("sha256", getStateSecret()).update(body).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Signed OAuth state. tenantId/agentId come from the server session only.
 * The browser never supplies those ids.
 */
export function normalizeCalendarReturnTo(value) {
  return value === "join" ? "join" : "settings";
}

export function createCalendarOAuthState({
  tenantId,
  agentId,
  tenantSlug,
  returnTo = "settings",
}) {
  const tenant = String(tenantId || "").trim();
  const agent = String(agentId || "").trim();
  const slug = String(tenantSlug || "").trim();
  if (!tenant || !agent || !slug) {
    throw new Error("tenantId, agentId, and tenantSlug are required for OAuth state");
  }
  const payload = {
    v: STATE_VERSION,
    exp: Date.now() + STATE_MAX_AGE_MS,
    nonce: randomBytes(16).toString("hex"),
    tenantId: tenant,
    agentId: agent,
    tenantSlug: slug,
    returnTo: normalizeCalendarReturnTo(returnTo),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyCalendarOAuthState(state) {
  const raw = String(state || "").trim();
  const sep = raw.lastIndexOf(".");
  if (sep < 1) return null;
  const body = raw.slice(0, sep);
  const sig = raw.slice(sep + 1);
  try {
    if (!safeEqual(sig, sign(body))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (Number(payload?.v) !== STATE_VERSION) return null;
    if (!payload?.exp || Date.now() > payload.exp) return null;
    const tenantId = String(payload.tenantId || "").trim();
    const agentId = String(payload.agentId || "").trim();
    const tenantSlug = String(payload.tenantSlug || "").trim();
    if (!tenantId || !agentId || !tenantSlug) return null;
    return {
      tenantId,
      agentId,
      tenantSlug,
      returnTo: normalizeCalendarReturnTo(payload.returnTo),
      exp: payload.exp,
      nonce: payload.nonce,
    };
  } catch {
    return null;
  }
}

/** Session must match the signed state — never a query-string tenant/agent. */
export function sessionMatchesOAuthState(session, statePayload) {
  if (!session || !statePayload) return false;
  return (
    String(session.tenantId) === String(statePayload.tenantId) &&
    String(session.agentId) === String(statePayload.agentId)
  );
}

import { createHmac, timingSafeEqual } from "crypto";
import { COPILOT_SESSION_COOKIE } from "@/lib/copilot-auth-constants";

export { COPILOT_SESSION_COOKIE };

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;
/** v3 binds agent_id + tenant_id. v2 username-only cookies must re-login. */
const SESSION_VERSION = 3;

function getSecret() {
  const secret = process.env.COPILOT_SESSION_SECRET;
  if (!secret) {
    throw new Error("COPILOT_SESSION_SECRET is not configured");
  }
  return secret;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ""));
  const bufB = Buffer.from(String(b ?? ""));
  if (bufA.length !== bufB.length) {
    // Keep compare work roughly constant when lengths differ.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function normalizeUser(entry) {
  if (!entry || typeof entry !== "object") return null;
  const username = String(entry.username ?? "").trim();
  const password = String(entry.password ?? "");
  const tenantSlug = String(entry.tenantSlug ?? "").trim();
  if (!username || !password || !tenantSlug) return null;
  return { username, password, tenantSlug };
}

/**
 * Preferred: COPILOT_USERS_JSON=[{"username":"...","password":"...","tenantSlug":"condo-city"}, ...]
 * Fallback: COPILOT_USERNAME + COPILOT_PASSWORD bound to COPILOT_HOME_TENANT (default 1416).
 */
export function getCopilotUsers() {
  const raw = process.env.COPILOT_USERS_JSON?.trim();
  if (raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("COPILOT_USERS_JSON is not valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("COPILOT_USERS_JSON must be a non-empty array");
    }
    const users = parsed.map(normalizeUser).filter(Boolean);
    if (!users.length) {
      throw new Error("COPILOT_USERS_JSON has no valid users");
    }
    return users;
  }

  const username = process.env.COPILOT_USERNAME?.trim();
  const password = process.env.COPILOT_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "COPILOT_USERS_JSON or COPILOT_USERNAME/COPILOT_PASSWORD must be set"
    );
  }
  const tenantSlug =
    String(process.env.COPILOT_HOME_TENANT || "1416").trim() || "1416";
  return [{ username, password, tenantSlug }];
}

/**
 * @returns {{ username: string, tenantSlug: string } | null}
 */
export function verifyCopilotCredentials(username, password) {
  const users = getCopilotUsers();
  const incomingUser = String(username ?? "").trim();
  const incomingPass = String(password ?? "");

  let matched = null;
  for (const user of users) {
    const userOk = safeEqual(incomingUser, user.username);
    const passOk = safeEqual(incomingPass, user.password);
    if (userOk && passOk) {
      matched = { username: user.username, tenantSlug: user.tenantSlug };
    }
  }
  return matched;
}

/** Unset or anything other than 0/false/off → fallback on (migration safety). */
export function isCopilotJsonFallbackEnabled() {
  const raw = String(process.env.COPILOT_AUTH_JSON_FALLBACK ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function signPayload(payload) {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", getSecret()).update(body).digest("hex");
  return `${body}|${sig}`;
}

export function createCopilotSessionToken({ agentId, tenantId, tenantSlug }) {
  const slug = String(tenantSlug || "").trim();
  const agent = String(agentId || "").trim();
  const tenant = String(tenantId || "").trim();
  if (!slug || !agent || !tenant) {
    throw new Error("agentId, tenantId, and tenantSlug are required for session token");
  }
  const payload = {
    v: SESSION_VERSION,
    exp: Date.now() + SESSION_MAX_AGE_SEC * 1000,
    agentId: agent,
    tenantId: tenant,
    tenantSlug: slug,
  };
  return signPayload(payload);
}

/**
 * @returns {{ v: number, exp: number, agentId: string, tenantId: string, tenantSlug: string } | null}
 */
export function verifyCopilotSessionToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const secret = process.env.COPILOT_SESSION_SECRET;
    if (!secret) return null;

    const sep = token.lastIndexOf("|");
    if (sep === -1) return null;
    const body = token.slice(0, sep);
    const sig = token.slice(sep + 1);
    const expectedSig = createHmac("sha256", secret).update(body).digest("hex");
    if (!safeEqual(sig, expectedSig)) return null;

    const payload = JSON.parse(body);
    if (!payload?.exp || Date.now() > payload.exp) return null;
    const tenantSlug = String(payload.tenantSlug || "").trim();
    const agentId = String(payload.agentId || "").trim();
    const tenantId = String(payload.tenantId || "").trim();
    if (!tenantSlug || !agentId || !tenantId) return null;
    if (Number(payload.v) !== SESSION_VERSION) return null;
    return {
      v: SESSION_VERSION,
      exp: payload.exp,
      agentId,
      tenantId,
      tenantSlug,
    };
  } catch {
    return null;
  }
}

export function sessionAllowsTenant(session, tenantSlug) {
  if (!session?.tenantSlug) return false;
  return (
    String(session.tenantSlug).trim() === String(tenantSlug || "").trim()
  );
}

/** Extract tenant slug from /copilot/:tenant or /api/copilot/:tenant/... */
export function tenantSlugFromCopilotPath(pathname) {
  const path = String(pathname || "");
  const pageMatch = path.match(/^\/copilot\/([^/]+)(?:\/|$)/);
  if (pageMatch) {
    const segment = decodeURIComponent(pageMatch[1]);
    if (segment === "login") return null;
    return segment;
  }
  const apiMatch = path.match(/^\/api\/copilot\/([^/]+)(?:\/|$)/);
  if (apiMatch) {
    const segment = decodeURIComponent(apiMatch[1]);
    if (segment === "auth") return null;
    return segment;
  }
  return null;
}

export function copilotSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  };
}

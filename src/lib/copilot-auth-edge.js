import { COPILOT_SESSION_COOKIE } from "@/lib/copilot-auth-constants";

export { COPILOT_SESSION_COOKIE };

const encoder = new TextEncoder();

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(sig);
}

function safeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let match = true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) match = false;
  }
  return match;
}

/**
 * @returns {Promise<{ v: number, exp: number, agentId: string, tenantId: string, tenantSlug: string } | null>}
 */
export async function verifyCopilotSessionTokenEdge(token) {
  const secret = process.env.COPILOT_SESSION_SECRET;
  if (!secret || !token) return null;

  const sep = token.lastIndexOf("|");
  if (sep === -1) return null;

  const body = token.slice(0, sep);
  const sig = token.slice(sep + 1);
  const expected = await hmacSha256Hex(secret, body);
  if (!safeEqualHex(sig, expected)) return null;

  try {
    const payload = JSON.parse(body);
    if (!payload?.exp || Date.now() > payload.exp) return null;
    const tenantSlug = String(payload.tenantSlug || "").trim();
    const agentId = String(payload.agentId || "").trim();
    const tenantId = String(payload.tenantId || "").trim();
    if (!tenantSlug || !agentId || !tenantId) return null;
    if (Number(payload.v) !== 3) return null;
    return {
      v: 3,
      exp: payload.exp,
      agentId,
      tenantId,
      tenantSlug,
    };
  } catch {
    return null;
  }
}

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

import { ONBOARD_SESSION_COOKIE } from "@/lib/onboard-auth-constants";

export { ONBOARD_SESSION_COOKIE };

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

export async function verifyOnboardSessionTokenEdge(token) {
  const secret = process.env.ONBOARD_AUTH_SECRET;
  if (!secret || !token) return false;

  const sep = token.lastIndexOf("|");
  if (sep === -1) return false;

  const body = token.slice(0, sep);
  const sig = token.slice(sep + 1);
  const expected = await hmacSha256Hex(secret, body);
  if (sig.length !== expected.length) return false;

  let match = true;
  for (let i = 0; i < sig.length; i++) {
    if (sig[i] !== expected[i]) match = false;
  }
  if (!match) return false;

  try {
    const payload = JSON.parse(body);
    return Boolean(payload?.exp && Date.now() <= payload.exp);
  } catch {
    return false;
  }
}

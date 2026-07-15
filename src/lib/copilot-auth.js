import { createHmac, timingSafeEqual } from "crypto";
import { COPILOT_SESSION_COOKIE } from "@/lib/copilot-auth-constants";

export { COPILOT_SESSION_COOKIE };

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

function getSecret() {
  const secret = process.env.COPILOT_SESSION_SECRET;
  if (!secret) {
    throw new Error("COPILOT_SESSION_SECRET is not configured");
  }
  return secret;
}

function getExpectedCredentials() {
  const username = process.env.COPILOT_USERNAME?.trim();
  const password = process.env.COPILOT_PASSWORD;
  if (!username || !password) {
    throw new Error("COPILOT_USERNAME and COPILOT_PASSWORD must be set");
  }
  return { username, password };
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyCopilotCredentials(username, password) {
  const expected = getExpectedCredentials();
  const userOk = safeEqual(String(username ?? "").trim(), expected.username);
  const passOk = safeEqual(String(password ?? ""), expected.password);
  return userOk && passOk;
}

function signPayload(payload) {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", getSecret()).update(body).digest("hex");
  return `${body}|${sig}`;
}

export function createCopilotSessionToken() {
  const payload = {
    v: 1,
    exp: Date.now() + SESSION_MAX_AGE_SEC * 1000,
  };
  return signPayload(payload);
}

export function verifyCopilotSessionToken(token) {
  if (!token || typeof token !== "string") return false;
  try {
    const secret = process.env.COPILOT_SESSION_SECRET;
    if (!secret) return false;

    const sep = token.lastIndexOf("|");
    if (sep === -1) return false;
    const body = token.slice(0, sep);
    const sig = token.slice(sep + 1);
    const expectedSig = createHmac("sha256", secret).update(body).digest("hex");
    if (!safeEqual(sig, expectedSig)) return false;

    const payload = JSON.parse(body);
    if (!payload?.exp || Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
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

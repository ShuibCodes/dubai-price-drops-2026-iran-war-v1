import crypto from "crypto";

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

export function parseMetaSignedRequest(signedRequest, appSecret) {
  if (!signedRequest || !appSecret) return null;

  const parts = String(signedRequest).split(".", 2);
  if (parts.length !== 2) return null;

  const [encodedSig, payload] = parts;
  const signature = decodeBase64Url(encodedSig);
  const expected = crypto.createHmac("sha256", appSecret).update(payload).digest();

  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(payload).toString("utf8"));
  } catch {
    return null;
  }
}

export function createDeletionConfirmationCode(metaUserId) {
  const suffix = crypto.randomBytes(6).toString("hex");
  const userPart = String(metaUserId || "user").replace(/\W/g, "").slice(0, 12);
  return `DEL-${userPart}-${suffix}`.toUpperCase();
}

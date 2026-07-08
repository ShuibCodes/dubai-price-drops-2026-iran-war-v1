import crypto from "crypto";

export function timingSafeEqual(a, b) {
  if (a == null || b == null) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

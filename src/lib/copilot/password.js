import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEYLEN = 32;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password ?? ""), salt, KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const raw = String(stored || "");
  const parts = raw.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const actualHex = scryptSync(String(password ?? ""), salt, KEYLEN).toString("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

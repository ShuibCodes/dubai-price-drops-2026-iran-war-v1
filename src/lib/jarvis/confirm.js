/**
 * Shared yes/no matchers for Jarvis durable pending confirmations
 * (contact save, relay dial, batch callback).
 *
 * Affirmatives are exact-phrase only (after light normalize) so chatter like
 * "ok thanks" does NOT confirm and does NOT clear pending.
 * Negatives clear pending (exact phrase or leading cancel word).
 */

function normalizeConfirmText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,…]+$/g, "")
    .replace(/\s+/g, " ");
}

const AFFIRMATIVE_BASE = new Set([
  "yes",
  "y",
  "yeah",
  "yep",
  "yup",
  "confirm",
  "confirmed",
  "go",
  "go ahead",
  "do it",
  "proceed",
  "ok",
  "okay",
  "sure",
]);

/** Contact-save only — do not treat "call …" as confirming a save. */
const AFFIRMATIVE_SAVE = new Set([
  "save",
  "save it",
  "add",
  "add them",
  "add him",
  "add her",
]);

/** Relay dial only. */
const AFFIRMATIVE_CALL = new Set([
  "call",
  "call him",
  "call her",
  "call them",
  "dial",
]);

const NEGATIVE_EXACT = new Set([
  "no",
  "n",
  "nope",
  "nah",
  "cancel",
  "cancelled",
  "canceled",
  "nevermind",
  "never mind",
  "forget it",
  "stop",
  "abort",
  "don't",
  "dont",
  "do not",
]);

/**
 * @param {string} text
 * @param {{ allowCall?: boolean, allowSave?: boolean }} [options]
 */
export function isJarvisAffirmative(text, options = {}) {
  const { allowCall = false, allowSave = false } = options;
  const normalized = normalizeConfirmText(text);
  if (!normalized) return false;
  if (AFFIRMATIVE_BASE.has(normalized)) return true;
  if (allowSave && AFFIRMATIVE_SAVE.has(normalized)) return true;
  if (allowCall && AFFIRMATIVE_CALL.has(normalized)) return true;
  return false;
}

export function isJarvisNegative(text) {
  const normalized = normalizeConfirmText(text);
  if (!normalized) return false;
  if (NEGATIVE_EXACT.has(normalized)) return true;
  // "no thanks", "cancel that", "never mind about it"
  return /^(no|nope|nah|cancel|never\s*mind|forget it|stop|abort|don'?t)\b/i.test(
    normalized
  );
}

import { GOALS, VOICE_ALLOWLIST } from "./schema.js";

const DUBAI = "Asia/Dubai";

export function goalLabel(goalId) {
  return GOALS.find((goal) => goal.id === goalId)?.label || goalId || "unspecified";
}

export function voiceLabel(voiceId) {
  return (
    VOICE_ALLOWLIST.find((voice) => voice.id === voiceId)?.label ||
    voiceId ||
    "voice"
  );
}

export function formatDay(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: DUBAI,
  });
}

export function formatRelative(iso, now = new Date()) {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDay(iso);
}

export function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("971")) return "+971 XX XXX XXXX";
  if (!digits) return "your number";
  return "+XX XXX XXX XXXX";
}

export function runsLabel(runs) {
  const n = Number(runs) || 0;
  if (n < 1) return "not used yet";
  return `used in ${n} run${n === 1 ? "" : "s"}`;
}

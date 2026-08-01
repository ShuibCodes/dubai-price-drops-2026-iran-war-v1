import { normalizeSenderPhone } from "@/lib/jarvis/pending-relay";

function jarvisAllowlist() {
  return String(process.env.JARVIS_WHATSAPP_WA_IDS || "")
    .split(",")
    .map((value) => value.replace(/\D/g, ""))
    .filter(Boolean);
}

/** Allowlisted WhatsApp senders for Jarvis relay / contact-save actions. */
export function isJarvisSenderAllowed(senderPhone) {
  const key = normalizeSenderPhone(senderPhone);
  if (!key) return false;
  const allow = jarvisAllowlist();
  if (!allow.length) return false;
  return allow.includes(key);
}

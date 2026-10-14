import { AsyncLocalStorage } from "node:async_hooks";
import { normalizeWaId } from "@/lib/supabase/server";

const inboundStore = new AsyncLocalStorage();

/**
 * AgentZero's own WhatsApp sender.
 *
 * Live replies use the Twilio webhook `To` (the number the agent texted).
 * Outbound summaries use TWILIO_WHATSAPP_FROM, and TWILIO_PHONE_NUMBER only
 * when that from-address is unset — the same fallback the Vapi summary path
 * already uses.
 *
 * agents.wa_id is the human agent's personal number. It is not this identity.
 */
export function configuredAgentZeroWhatsAppRaw() {
  const configured = String(process.env.TWILIO_WHATSAPP_FROM || "").trim();
  if (configured) return configured;
  return String(process.env.TWILIO_PHONE_NUMBER || "").trim();
}

export function agentZeroWhatsAppFromAddress() {
  const raw = configuredAgentZeroWhatsAppRaw();
  if (!raw) return null;
  return raw.startsWith("whatsapp:") ? raw : `whatsapp:${raw}`;
}

export function bindAgentZeroInboundTo(inboundTo, fn) {
  return inboundStore.run({ inboundTo: normalizeWaId(inboundTo) }, fn);
}

export function agentZeroSelfWaIds() {
  const ids = new Set();
  const bound = inboundStore.getStore()?.inboundTo;
  if (bound) ids.add(bound);
  const configured = normalizeWaId(configuredAgentZeroWhatsAppRaw());
  if (configured) ids.add(configured);
  return ids;
}

export function isAgentZeroSelfContact(waId) {
  const digits = normalizeWaId(waId);
  if (!digits) return false;
  return agentZeroSelfWaIds().has(digits);
}

/** Drop jarvis_leads rows whose wa_id is AgentZero's own sender. */
export function excludeAgentZeroSelfChat(query) {
  let next = query;
  for (const waId of agentZeroSelfWaIds()) {
    next = next.neq("wa_id", waId);
  }
  return next;
}

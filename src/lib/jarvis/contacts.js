import { upsertJarvisLead } from "@/lib/ingest/jarvis-ingest";
import {
  isJarvisAffirmative,
  isJarvisNegative,
} from "@/lib/jarvis/confirm";
import {
  clearPendingContact,
  getPendingContact,
  setPendingContact,
} from "@/lib/jarvis/pending-contact";
import {
  clearPendingRelay,
  normalizeSenderPhone,
} from "@/lib/jarvis/pending-relay";
import { isJarvisSenderAllowed } from "@/lib/jarvis/sender-allowlist";
import { normalizePhone, phoneToWaId } from "@/lib/leads/normalize";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const SAVE_JARVIS_CONTACT_DESCRIPTION = `Save a new contact (name + phone) into the Jarvis WhatsApp address book (jarvis_leads) so they become searchable and callable.

Use when the user wants to ADD / SAVE / STORE a person with a phone number, or when a relay failed because the contact was not found and they provided a number.

Do NOT dial — only save. After save, they can place_relay_call or start_target_call.

Always pass the name exactly as the user wants it saved, and the phone as they gave it (any international format).
This tool NEVER writes without confirmation — it returns needs_confirmation; the WhatsApp "yes" handler completes the upsert.`;

export function formatContactConfirmation({ name, phone }) {
  return `Save ${name} at ${phone} as a contact? Reply yes to add them.`;
}

function cleanContactName(name) {
  return String(name || "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * First-turn tool: validate + persist pending confirmation. Does NOT upsert yet.
 */
export async function saveJarvisContact({
  tenantId,
  senderPhone,
  name,
  phone,
}) {
  if (!isJarvisSenderAllowed(senderPhone)) {
    return {
      status: "forbidden",
      error: "Saving contacts is only available for allowlisted Jarvis WhatsApp senders.",
    };
  }

  const contactName = cleanContactName(name);
  if (!contactName || contactName.length < 2) {
    return {
      status: "invalid_name",
      error: "Need a real name (at least 2 characters).",
    };
  }

  const phoneE164 = normalizePhone(phone);
  const waId = phoneToWaId(phone);
  if (!phoneE164 || !waId || waId.length < 10) {
    return {
      status: "invalid_phone",
      error:
        "Could not parse that phone number. Ask for full international digits (e.g. +4477… or +9715…).",
    };
  }

  // Clear any competing pending relay so "yes" can't dial the wrong thing.
  await clearPendingRelay(senderPhone).catch(() => null);

  await setPendingContact({
    senderPhone,
    tenantId,
    name: contactName,
    phoneE164,
    waId,
  });

  return {
    status: "needs_confirmation",
    name: contactName,
    phone: phoneE164,
    waId,
    confirmationPrompt: formatContactConfirmation({
      name: contactName,
      phone: phoneE164,
    }),
    requiresConfirmation: true,
    action: "save_contact",
  };
}

/**
 * Upsert jarvis_leads for a confirmed name + phone. Shared by contact confirm
 * and create-then-relay paths.
 */
export async function upsertCallableJarvisContact({
  tenantId,
  name,
  phoneE164,
  waId,
}) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const digits = String(waId || phoneToWaId(phoneE164) || "").replace(/\D/g, "");
  if (!digits) throw new Error("wa_id is required");

  const contactName = cleanContactName(name) || "Contact";
  const lead = await upsertJarvisLead({
    supabase,
    tenantId,
    waId: digits,
    pushName: contactName,
    messageAt: new Date().toISOString(),
  });

  return {
    id: lead.id,
    name: lead.push_name || contactName,
    phone: phoneE164 || `+${digits}`,
    wa_id: lead.wa_id || digits,
  };
}

/**
 * Confirm + upsert a pending contact (WhatsApp "yes" path).
 * Returns null if there was no pending contact, or if the message is neither
 * yes nor no (pending is left intact so a later "yes" still works).
 * Clears pending only on no/cancel, success, failure, or expiry (via get).
 */
export async function handleContactConfirmationMessage({
  tenantId,
  senderPhone,
  message,
}) {
  const pending = await getPendingContact(senderPhone);
  if (!pending) return null;
  if (pending.tenant_id && tenantId && pending.tenant_id !== tenantId) {
    await clearPendingContact(senderPhone);
    return null;
  }

  if (isJarvisNegative(message)) {
    await clearPendingContact(senderPhone);
    return {
      handled: true,
      text: "Okay — I won't save that contact.",
    };
  }

  if (!isJarvisAffirmative(message, { allowSave: true })) {
    return null;
  }

  if (!isJarvisSenderAllowed(senderPhone)) {
    await clearPendingContact(senderPhone);
    return {
      handled: true,
      text: "Contact saves are locked to your allowlisted WhatsApp number.",
    };
  }

  try {
    const saved = await upsertCallableJarvisContact({
      tenantId: pending.tenant_id || tenantId,
      name: pending.name,
      phoneE164: pending.phone_e164,
      waId: pending.wa_id,
    });
    await clearPendingContact(senderPhone);
    return {
      handled: true,
      text: `Saved ${saved.name} at ${saved.phone}. They're in your contacts now — you can call or relay anytime.`,
      saved,
    };
  } catch (error) {
    await clearPendingContact(senderPhone);
    return {
      handled: true,
      text: `Couldn't save that contact: ${error.message}`,
    };
  }
}

export { normalizeSenderPhone };

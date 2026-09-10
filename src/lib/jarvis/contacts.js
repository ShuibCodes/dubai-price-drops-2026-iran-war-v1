import { JARVIS_LEADS_TABLE } from "@/lib/ingest/jarvis-ingest";
import { findTenantAgentIdByWaId } from "@/lib/leads/assigned-agent";
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
import {
  applyVisibleInboxLeadScope,
  assertJarvisActor,
  inboxLeadVisible,
} from "@/lib/jarvis/visibility";
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
  agentId,
  senderPhone,
  name,
  phone,
}) {
  assertJarvisActor({ tenantId, agentId });
  if (
    !(await isJarvisSenderAllowed(senderPhone, { tenantId, agentId }))
  ) {
    return {
      status: "forbidden",
      error: "Saving contacts is only available for AgentZero agents on this number.",
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
  senderPhone,
  assignedAgentId = null,
  supabase: supabaseArg = null,
}) {
  const supabase = supabaseArg || getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const digits = String(waId || phoneToWaId(phoneE164) || "").replace(/\D/g, "");
  if (!digits) throw new Error("wa_id is required");

  let ownerId = assignedAgentId || null;
  const senderAgentId = senderPhone
    ? await findTenantAgentIdByWaId(supabase, tenantId, senderPhone)
    : null;
  if (ownerId && ownerId !== senderAgentId) {
    throw new Error("Agent identity does not match senderPhone");
  }
  if (!ownerId) ownerId = senderAgentId;
  if (!ownerId) {
    throw new Error(
      "assignedAgentId is required: could not match the saving agent in this tenant."
    );
  }

  const contactName = cleanContactName(name) || "Contact";
  const { data: existing, error: lookupError } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .select("id, assigned_agent_id")
    .eq("tenant_id", tenantId)
    .eq("wa_id", digits)
    .maybeSingle();
  if (lookupError) throw new Error(`Contact lookup failed: ${lookupError.message}`);
  if (existing && !inboxLeadVisible(existing, ownerId)) {
    throw new Error("Contact belongs to another agent");
  }

  let lead;
  if (existing) {
    const { data, error } = await applyVisibleInboxLeadScope(
      supabase
        .from(JARVIS_LEADS_TABLE)
        .update({
          push_name: contactName,
          last_message_at: new Date().toISOString(),
          assigned_agent_id: existing.assigned_agent_id || ownerId,
        })
        .eq("id", existing.id),
      { tenantId, agentId: ownerId }
    )
      .select("id, push_name, wa_id, assigned_agent_id")
      .maybeSingle();
    if (error) throw new Error(`Contact update failed: ${error.message}`);
    if (!data) throw new Error("Contact belongs to another agent");
    lead = data;
  } else {
    const { data, error } = await supabase
      .from(JARVIS_LEADS_TABLE)
      .insert({
        tenant_id: tenantId,
        wa_id: digits,
        push_name: contactName,
        first_seen: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        assigned_agent_id: ownerId,
      })
      .select("id, push_name, wa_id, assigned_agent_id")
      .single();
    if (error) throw new Error(`Contact insert failed: ${error.message}`);
    lead = data;
  }

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
  agentId,
  senderPhone,
  message,
}) {
  assertJarvisActor({ tenantId, agentId });
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

  if (
    !(await isJarvisSenderAllowed(senderPhone, { tenantId, agentId }))
  ) {
    await clearPendingContact(senderPhone);
    return {
      handled: true,
      text: "Contact saves are locked to your AgentZero WhatsApp number.",
    };
  }

  try {
    const saved = await upsertCallableJarvisContact({
      tenantId: pending.tenant_id || tenantId,
      name: pending.name,
      phoneE164: pending.phone_e164,
      waId: pending.wa_id,
      senderPhone,
      assignedAgentId: agentId,
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

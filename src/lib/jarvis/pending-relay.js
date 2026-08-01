import { getSupabaseServerClient } from "@/lib/supabase/server";

const PENDING_TTL_MS = 10 * 60 * 1000;

export function normalizeSenderPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function db() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function getPendingRelay(senderPhone) {
  const key = normalizeSenderPhone(senderPhone);
  if (!key) return null;
  const supabase = db();
  const { data, error } = await supabase
    .from("jarvis_pending_relays")
    .select(
      "sender_phone, tenant_id, lead_id, phone_e164, customer_name, task, create_contact, expires_at, created_at"
    )
    .eq("sender_phone", key)
    .maybeSingle();
  if (error) throw new Error(`Pending relay lookup failed: ${error.message}`);
  if (!data) return null;

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await clearPendingRelay(key);
    return null;
  }
  return data;
}

export async function setPendingRelay({
  senderPhone,
  tenantId,
  leadId,
  phoneE164,
  customerName,
  task,
  createContact = false,
}) {
  const key = normalizeSenderPhone(senderPhone);
  if (!key) throw new Error("senderPhone is required for pending relay");
  const supabase = db();
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
  const row = {
    sender_phone: key,
    tenant_id: tenantId,
    lead_id: leadId || null,
    phone_e164: phoneE164,
    customer_name: customerName,
    task,
    create_contact: Boolean(createContact),
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("jarvis_pending_relays")
    .upsert(row, { onConflict: "sender_phone" })
    .select(
      "sender_phone, tenant_id, lead_id, phone_e164, customer_name, task, create_contact, expires_at, created_at"
    )
    .single();
  if (error) throw new Error(`Pending relay save failed: ${error.message}`);
  return data;
}

export async function clearPendingRelay(senderPhone) {
  const key = normalizeSenderPhone(senderPhone);
  if (!key) return;
  const supabase = db();
  const { error } = await supabase
    .from("jarvis_pending_relays")
    .delete()
    .eq("sender_phone", key);
  if (error) throw new Error(`Pending relay clear failed: ${error.message}`);
}

export function isRelayAffirmative(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /^(yes|y|yeah|yep|yup|confirm|confirmed|go|go ahead|do it|proceed|call|call him|call her|call them|dial|ok|okay)\b/i.test(
    raw
  );
}

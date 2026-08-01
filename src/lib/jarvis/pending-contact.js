import { getSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeSenderPhone } from "@/lib/jarvis/pending-relay";

const PENDING_TTL_MS = 10 * 60 * 1000;

function db() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function getPendingContact(senderPhone) {
  const key = normalizeSenderPhone(senderPhone);
  if (!key) return null;
  const supabase = db();
  const { data, error } = await supabase
    .from("jarvis_pending_contacts")
    .select(
      "sender_phone, tenant_id, name, phone_e164, wa_id, expires_at, created_at"
    )
    .eq("sender_phone", key)
    .maybeSingle();
  if (error) throw new Error(`Pending contact lookup failed: ${error.message}`);
  if (!data) return null;

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await clearPendingContact(key);
    return null;
  }
  return data;
}

export async function setPendingContact({
  senderPhone,
  tenantId,
  name,
  phoneE164,
  waId,
}) {
  const key = normalizeSenderPhone(senderPhone);
  if (!key) throw new Error("senderPhone is required for pending contact");
  const supabase = db();
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
  const row = {
    sender_phone: key,
    tenant_id: tenantId,
    name: String(name || "").trim(),
    phone_e164: phoneE164,
    wa_id: waId,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("jarvis_pending_contacts")
    .upsert(row, { onConflict: "sender_phone" })
    .select(
      "sender_phone, tenant_id, name, phone_e164, wa_id, expires_at, created_at"
    )
    .single();
  if (error) throw new Error(`Pending contact save failed: ${error.message}`);
  return data;
}

export async function clearPendingContact(senderPhone) {
  const key = normalizeSenderPhone(senderPhone);
  if (!key) return;
  const supabase = db();
  const { error } = await supabase
    .from("jarvis_pending_contacts")
    .delete()
    .eq("sender_phone", key);
  if (error) throw new Error(`Pending contact clear failed: ${error.message}`);
}

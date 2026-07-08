// Shared lead/message ingest used by the Meta and Whautomate webhooks.
// Logic moved verbatim from src/lib/meta/webhook-handler.js — do not change behaviour.

export async function upsertLead({ supabase, tenantId, waId, pushName, messageAt }) {
  const nowIso = messageAt || new Date().toISOString();

  const { data: existingLead } = await supabase
    .from("leads")
    .select("id, push_name, first_seen, last_message_at")
    .eq("tenant_id", tenantId)
    .eq("wa_id", waId)
    .maybeSingle();

  if (existingLead) {
    const { data: updatedLead, error } = await supabase
      .from("leads")
      .update({
        push_name: pushName || existingLead.push_name,
        last_message_at: nowIso,
      })
      .eq("id", existingLead.id)
      .select("id")
      .single();

    if (error) throw error;
    return updatedLead;
  }

  const { data: insertedLead, error } = await supabase
    .from("leads")
    .insert({
      tenant_id: tenantId,
      wa_id: waId,
      push_name: pushName,
      first_seen: nowIso,
      last_message_at: nowIso,
    })
    .select("id")
    .single();

  if (error) throw error;
  return insertedLead;
}

export async function insertMessageIfNew({
  supabase,
  tenantId,
  leadId,
  waMessageId,
  direction,
  body,
  msgType,
  mediaId,
  timestamp,
  raw,
}) {
  const { data: existingMessage } = await supabase
    .from("messages")
    .select("id")
    .eq("wa_message_id", waMessageId)
    .maybeSingle();

  if (existingMessage) return;

  const { error } = await supabase.from("messages").insert({
    tenant_id: tenantId,
    lead_id: leadId,
    wa_message_id: waMessageId,
    direction,
    body,
    msg_type: msgType,
    media_id: mediaId,
    timestamp,
    raw,
  });

  if (error) throw error;
}

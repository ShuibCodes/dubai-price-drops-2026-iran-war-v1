import { MESSAGES_TABLE } from "@/lib/supabase/server";

export const JARVIS_LEADS_TABLE = "jarvis_leads";

export async function upsertJarvisLead({
  supabase,
  tenantId,
  waId,
  pushName,
  messageAt,
  whautomateContactId = null,
}) {
  const nowIso = messageAt || new Date().toISOString();

  const { data: existingLead } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .select(
      "id, push_name, first_seen, last_message_at, whautomate_contact_id, bot_paused_until, wa_id"
    )
    .eq("tenant_id", tenantId)
    .eq("wa_id", waId)
    .maybeSingle();

  if (existingLead) {
    const patch = {
      push_name: pushName || existingLead.push_name,
      last_message_at: nowIso,
    };
    if (whautomateContactId) {
      patch.whautomate_contact_id = whautomateContactId;
    }

    const { data: updatedLead, error } = await supabase
      .from(JARVIS_LEADS_TABLE)
      .update(patch)
      .eq("id", existingLead.id)
      .select("id, push_name, wa_id, whautomate_contact_id, bot_paused_until")
      .single();

    if (error) throw error;
    return updatedLead;
  }

  const insertRow = {
    tenant_id: tenantId,
    wa_id: waId,
    push_name: pushName,
    first_seen: nowIso,
    last_message_at: nowIso,
  };
  if (whautomateContactId) {
    insertRow.whautomate_contact_id = whautomateContactId;
  }

  const { data: insertedLead, error } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .insert(insertRow)
    .select("id, push_name, wa_id, whautomate_contact_id, bot_paused_until")
    .single();

  if (error) throw error;
  return insertedLead;
}

export async function insertJarvisMessageIfNew({
  supabase,
  tenantId,
  jarvisLeadId,
  waMessageId,
  direction,
  body,
  msgType,
  mediaId,
  timestamp,
  raw,
  sentByBot = false,
}) {
  const { data: existingMessage } = await supabase
    .from(MESSAGES_TABLE)
    .select("id")
    .eq("wa_message_id", waMessageId)
    .maybeSingle();

  if (existingMessage) return { inserted: false, id: existingMessage.id };

  if (direction === "outbound" && !sentByBot && body) {
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: botDup } = await supabase
      .from(MESSAGES_TABLE)
      .select("id")
      .eq("jarvis_lead_id", jarvisLeadId)
      .eq("direction", "outbound")
      .eq("sent_by_bot", true)
      .eq("body", body)
      .gte("timestamp", since)
      .limit(1);
    if (botDup?.length) {
      return { inserted: false, id: botDup[0].id, reason: "bot_echo_dedup" };
    }
  }

  const { data, error } = await supabase
    .from(MESSAGES_TABLE)
    .insert({
      tenant_id: tenantId,
      lead_id: null,
      jarvis_lead_id: jarvisLeadId,
      wa_message_id: waMessageId,
      direction,
      body,
      msg_type: msgType,
      media_id: mediaId,
      timestamp,
      raw,
      sent_by_bot: Boolean(sentByBot),
    })
    .select("id")
    .single();

  if (error) throw error;
  return { inserted: true, id: data.id };
}

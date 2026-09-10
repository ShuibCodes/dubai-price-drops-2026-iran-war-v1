import { sendRequestedMorningBrief } from "@/lib/brief/send";
import { MESSAGES_TABLE, normalizeWaId } from "@/lib/supabase/server";

export const SEND_BRIEF_BUTTON_ID = "send_brief";

function isSendBriefPayload(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === SEND_BRIEF_BUTTON_ID || normalized === "send brief";
}

export function isSendBriefButton(message) {
  if (message?.type !== "interactive") return false;
  if (message?.interactive?.type !== "button_reply") return false;
  const reply = message?.interactive?.button_reply || {};
  return isSendBriefPayload(reply.id) || isSendBriefPayload(reply.title);
}

function messageTimestamp(value) {
  const unixSeconds = Number(value);
  return Number.isFinite(unixSeconds)
    ? new Date(unixSeconds * 1000).toISOString()
    : new Date().toISOString();
}

function isBriefDelivered(raw) {
  return raw?.brief_delivered === true;
}

async function loadLockRow(supabase, tenantId, waMessageId) {
  const { data, error } = await supabase
    .from(MESSAGES_TABLE)
    .select("id, raw")
    .eq("tenant_id", tenantId)
    .eq("wa_message_id", waMessageId)
    .maybeSingle();
  if (error) throw new Error(`Brief button lock lookup failed: ${error.message}`);
  return data || null;
}

async function markBriefDelivered(supabase, tenantId, message, existingRaw) {
  const raw = {
    ...(existingRaw && typeof existingRaw === "object" ? existingRaw : {}),
    ...message,
    brief_delivered: true,
  };
  const { error } = await supabase
    .from(MESSAGES_TABLE)
    .update({ raw })
    .eq("tenant_id", tenantId)
    .eq("wa_message_id", message.id);
  if (error) throw new Error(`Brief button deliver mark failed: ${error.message}`);
}

async function reserveButtonDelivery(supabase, tenantId, message) {
  if (!message?.id) return { reserved: false, reason: "missing_message_id" };

  const { error } = await supabase.from(MESSAGES_TABLE).insert({
    tenant_id: tenantId,
    lead_id: null,
    jarvis_lead_id: null,
    wa_message_id: message.id,
    direction: "inbound",
    body:
      message?.interactive?.button_reply?.title ||
      SEND_BRIEF_BUTTON_ID,
    msg_type: "interactive",
    media_id: null,
    timestamp: messageTimestamp(message?.timestamp),
    raw: message,
    sent_by_bot: false,
  });

  if (!error) return { reserved: true, raw: message };
  if (error.code !== "23505") {
    throw new Error(`Brief button dedup failed: ${error.message}`);
  }

  const existing = await loadLockRow(supabase, tenantId, message.id);
  if (!existing) {
    return { reserved: false, reason: "duplicate" };
  }
  if (isBriefDelivered(existing.raw)) {
    return { reserved: false, reason: "duplicate" };
  }
  return { reserved: true, raw: existing.raw, retry: true };
}

export async function handleSendBriefButton({
  supabase,
  tenant,
  message,
  sendBrief = sendRequestedMorningBrief,
}) {
  if (!isSendBriefButton(message)) return { handled: false };

  const senderWaId = normalizeWaId(message?.from);
  if (!senderWaId) {
    return { handled: true, sent: false, reason: "unknown_agent" };
  }

  const { data: agent, error } = await supabase
    .from("agents")
    .select("id, tenant_id, name, wa_id")
    .eq("tenant_id", tenant.id)
    .eq("wa_id", senderWaId)
    .maybeSingle();
  if (error) throw new Error(`Brief agent lookup failed: ${error.message}`);
  if (!agent) {
    return { handled: true, sent: false, reason: "unknown_agent" };
  }

  const reservation = await reserveButtonDelivery(
    supabase,
    tenant.id,
    message
  );
  if (!reservation.reserved) {
    return { handled: true, sent: false, reason: reservation.reason };
  }

  const result = await sendBrief({ supabase, tenant, agent });
  if (result.sent) {
    await markBriefDelivered(
      supabase,
      tenant.id,
      message,
      reservation.raw
    );
  }
  return { handled: true, agentId: agent.id, ...result };
}

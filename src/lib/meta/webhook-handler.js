import { getSupabaseServerClient, normalizeWaId } from "@/lib/supabase/server";
import { resolveTenantByPhoneNumberId } from "@/lib/kb/resolve-tenant";
import { upsertLead, insertMessageIfNew } from "@/lib/ingest/message-ingest";

function unixToIso(unixSeconds) {
  const value = Number(unixSeconds);
  if (!Number.isFinite(value)) return new Date().toISOString();
  return new Date(value * 1000).toISOString();
}

function extractMessageBody(message) {
  const type = message?.type || "unknown";

  if (type === "text") {
    return message?.text?.body || "";
  }

  if (type === "image") {
    return JSON.stringify({
      type,
      media_id: message?.image?.id || null,
      caption: message?.image?.caption || null,
    });
  }

  if (type === "audio") {
    return JSON.stringify({
      type,
      media_id: message?.audio?.id || null,
    });
  }

  if (type === "document") {
    return JSON.stringify({
      type,
      media_id: message?.document?.id || null,
      filename: message?.document?.filename || null,
    });
  }

  if (type === "location") {
    return JSON.stringify({
      type,
      latitude: message?.location?.latitude ?? null,
      longitude: message?.location?.longitude ?? null,
      name: message?.location?.name || null,
      address: message?.location?.address || null,
    });
  }

  return JSON.stringify(message || {});
}

function extractMediaId(message) {
  const type = message?.type;
  if (type === "image") return message?.image?.id || null;
  if (type === "audio") return message?.audio?.id || null;
  if (type === "document") return message?.document?.id || null;
  return null;
}

function buildContactMap(contacts = []) {
  const map = new Map();
  for (const contact of contacts) {
    const waId = normalizeWaId(contact?.wa_id);
    if (!waId) continue;
    map.set(waId, contact?.profile?.name || null);
  }
  return map;
}

function collectEchoArrays(value) {
  const echoes = [];
  if (Array.isArray(value?.message_echoes)) echoes.push(...value.message_echoes);
  if (Array.isArray(value?.smb_message_echoes)) echoes.push(...value.smb_message_echoes);
  return echoes;
}

async function processMessage({
  supabase,
  tenantId,
  message,
  direction,
  contactMap,
}) {
  const waMessageId = message?.id;
  if (!waMessageId) return;

  const leadWaId =
    direction === "inbound"
      ? normalizeWaId(message?.from)
      : normalizeWaId(message?.to);

  if (!leadWaId) return;

  const pushName = contactMap.get(leadWaId) || null;
  const timestamp = unixToIso(message?.timestamp);
  const lead = await upsertLead({
    supabase,
    tenantId,
    waId: leadWaId,
    pushName,
    messageAt: timestamp,
  });

  await insertMessageIfNew({
    supabase,
    tenantId,
    leadId: lead.id,
    waMessageId,
    direction,
    body: extractMessageBody(message),
    msgType: message?.type || "unknown",
    mediaId: extractMediaId(message),
    timestamp,
    raw: message,
  });
}

export async function processMetaWebhookPayload(payload) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    console.error("Meta webhook: Supabase client unavailable");
    return;
  }

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value;
      if (!value) continue;

      const phoneNumberId = value?.metadata?.phone_number_id;
      const tenant = await resolveTenantByPhoneNumberId(phoneNumberId);

      if (!tenant) {
        console.warn(
          "Meta webhook: tenant not found for phone_number_id",
          phoneNumberId || "unknown"
        );
        continue;
      }

      const contactMap = buildContactMap(value?.contacts || []);
      const inboundMessages = Array.isArray(value?.messages) ? value.messages : [];
      const echoMessages = collectEchoArrays(value);

      for (const message of inboundMessages) {
        try {
          await processMessage({
            supabase,
            tenantId: tenant.id,
            message,
            direction: "inbound",
            contactMap,
          });
        } catch (error) {
          console.error("Meta webhook inbound message error:", error.message);
        }
      }

      for (const message of echoMessages) {
        try {
          await processMessage({
            supabase,
            tenantId: tenant.id,
            message,
            direction: "outbound",
            contactMap,
          });
        } catch (error) {
          console.error("Meta webhook echo message error:", error.message);
        }
      }
    }
  }
}

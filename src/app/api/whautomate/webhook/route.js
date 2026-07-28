import { getSupabaseServerClient, normalizeWaId } from "@/lib/supabase/server";
import {
  upsertJarvisLead,
  insertJarvisMessageIfNew,
} from "@/lib/ingest/jarvis-ingest";
import { timingSafeEqual } from "@/lib/security/timing-safe";
import { scheduleAutoReply } from "@/lib/whautomate/autoreply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function verifySecret(request) {
  const expected = process.env.WHAUTOMATE_WEBHOOK_SECRET;
  if (!expected) return true; // dev mode — accept everything while mapping the payload
  const url = new URL(request.url);
  const provided =
    request.headers.get("x-whautomate-secret") || url.searchParams.get("secret");
  return timingSafeEqual(provided, expected);
}

function clean(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
}

// Whautomate falls back to the phone number when it has no name for a
// contact — never store that as a person's name.
function realName(candidate, phone) {
  const name = clean(candidate);
  if (!name) return null;
  const lettersOnly = name.replace(/[\d\s+()./-]/g, "");
  if (!lettersOnly) return null;
  const nameDigits = name.replace(/\D/g, "");
  const phoneDigits = String(phone || "").replace(/\D/g, "");
  if (phoneDigits && nameDigits === phoneDigits) return null;
  return name;
}

const MESSAGE_EVENT_TYPES = new Set([
  "incoming_whatsapp_message",
  "outgoing_whatsapp_message",
]);

/**
 * Confirmed Whautomate payload shape:
 *   event.type: 'incoming_whatsapp_message' | 'outgoing_whatsapp_message'
 *   message.isIncoming: boolean (direction)
 *   message.from: sender name (inbound only — outbound sentBy is our side, not the lead)
 *   message.contact.phoneNumber: phone without plus prefix
 *   message.contact.id: thread anchor
 *   message.text, message.id, message.timestamp (ISO)
 */
function mapWhautomatePayload(payload = {}) {
  const eventType = clean(payload?.event?.type);
  if (eventType && !MESSAGE_EVENT_TYPES.has(eventType)) {
    return null;
  }

  const message = payload?.message;
  if (!message) return null;

  const isIncoming = message.isIncoming === true;
  const direction = isIncoming ? "inbound" : "outbound";

  const phone = clean(message.contact?.phoneNumber);

  // Prefer the saved contact name; fall back to the inbound sender name.
  // Outbound `from` is our own agent label — never the lead's name.
  const pushName =
    realName(message.contact?.name, phone) ||
    (isIncoming ? realName(message.from, phone) : null);

  const parsed = new Date(String(message.timestamp || ""));
  const timestamp = Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();

  return {
    phone,
    contactId: clean(message.contact?.id),
    pushName,
    body: clean(message.text),
    messageId: clean(message.id),
    timestamp,
    msgType: "text",
    direction,
  };
}

// Whautomate payloads carry no channel identifier — single-tenant fallback, silent
async function resolveTenant(supabase) {
  const { data } = await supabase
    .from("tenants")
    .select(
      "id, name, whautomate_channel_id, autoreply_enabled, reply_prompt"
    )
    .not("whautomate_channel_id", "is", null)
    .limit(1);

  return data?.[0] || null;
}

export async function GET() {
  return Response.json({
    ok: true,
    message: "Whautomate webhook is healthy. POST message events here.",
  });
}

export async function POST(request) {
  try {
    const payload = await request.json().catch(() => ({}));

    // FIRST PRIORITY: full raw payload log — mapping is tightened from these
    console.log("WHAUTOMATE RAW:", JSON.stringify(payload));

    if (!verifySecret(request)) {
      return Response.json({ ok: false, error: "Invalid secret" }, { status: 401 });
    }

    const mapped = mapWhautomatePayload(payload);

    if (!mapped) {
      return Response.json({ ok: true, ingested: false, reason: "not_a_message_event" });
    }

    if (!mapped.phone || !mapped.body) {
      console.log(
        `Whautomate webhook: skipping event (phone=${Boolean(mapped.phone)}, body=${Boolean(mapped.body)})`
      );
      return Response.json({ ok: true, ingested: false, reason: "unmapped_event" });
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      console.error("Whautomate webhook: Supabase client unavailable");
      return Response.json({ ok: true, ingested: false, reason: "no_supabase" });
    }

    const tenant = await resolveTenant(supabase);
    if (!tenant) {
      console.warn("Whautomate webhook: no tenant with whautomate_channel_id configured");
      return Response.json({ ok: true, ingested: false, reason: "no_tenant" });
    }

    const waId = normalizeWaId(mapped.phone);
    if (!waId) {
      return Response.json({ ok: true, ingested: false, reason: "invalid_phone" });
    }

    const lead = await upsertJarvisLead({
      supabase,
      tenantId: tenant.id,
      waId,
      pushName: mapped.pushName,
      messageAt: mapped.timestamp,
      whautomateContactId: mapped.contactId,
    });

    const waMessageId = mapped.messageId || `whautomate-${waId}-${mapped.timestamp}`;

    await insertJarvisMessageIfNew({
      supabase,
      tenantId: tenant.id,
      jarvisLeadId: lead.id,
      waMessageId,
      direction: mapped.direction,
      body: mapped.body,
      msgType: mapped.msgType,
      mediaId: null,
      timestamp: mapped.timestamp,
      raw: payload,
      sentByBot: false,
    });

    // Auto-reply: never block the webhook response on the LLM
    if (mapped.direction === "inbound") {
      scheduleAutoReply({
        supabase,
        tenant,
        lead,
        inboundBody: mapped.body,
      });
    }

    return Response.json({
      ok: true,
      ingested: true,
      direction: mapped.direction,
      leadId: lead.id,
    });
  } catch (error) {
    console.error("Whautomate webhook error:", error.message);
    return Response.json({ ok: true, ingested: false, error: error.message });
  }
}

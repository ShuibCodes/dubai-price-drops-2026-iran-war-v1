import { getSupabaseServerClient, normalizeWaId } from "@/lib/supabase/server";
import { upsertLead, insertMessageIfNew } from "@/lib/ingest/message-ingest";
import { timingSafeEqual } from "@/lib/security/timing-safe";

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

function firstString(...candidates) {
  for (const value of candidates) {
    if (value == null) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return null;
}

/**
 * Best-effort direction detection across common webhook field conventions.
 * Returns 'inbound' | 'outbound'.
 */
function detectDirection(payload, message) {
  const explicit = firstString(
    message?.direction,
    payload?.direction,
    message?.type,
    payload?.type,
    payload?.event,
    payload?.eventType
  );
  const lowered = (explicit || "").toLowerCase();

  if (
    message?.fromMe === true ||
    payload?.fromMe === true ||
    lowered.includes("outbound") ||
    lowered.includes("outgoing") ||
    lowered.includes("sent") ||
    lowered.includes("echo") ||
    lowered.includes("agent")
  ) {
    return "outbound";
  }

  const sender = firstString(message?.sender, payload?.sender, message?.author);
  if (sender && ["agent", "business", "operator", "user"].includes(sender.toLowerCase())) {
    return "outbound";
  }

  return "inbound";
}

/** Best-effort field mapping — refined from real "WHAUTOMATE RAW:" logs. */
function mapWhautomatePayload(payload = {}) {
  const message =
    payload?.message || payload?.data?.message || payload?.data || payload;
  const contact =
    payload?.contact ||
    payload?.customer ||
    payload?.data?.contact ||
    message?.contact ||
    {};

  const phone = firstString(
    contact?.phone,
    contact?.phoneNumber,
    contact?.whatsappNumber,
    contact?.wa_id,
    message?.from,
    message?.phone,
    payload?.from,
    payload?.phone
  );

  const pushName = firstString(
    contact?.name,
    contact?.fullName,
    contact?.firstName && contact?.lastName
      ? `${contact.firstName} ${contact.lastName}`
      : contact?.firstName,
    contact?.profileName,
    message?.senderName,
    payload?.name
  );

  const body = firstString(
    message?.text,
    message?.body,
    message?.message,
    message?.content,
    typeof payload?.text === "string" ? payload.text : null
  );

  const messageId = firstString(
    message?.id,
    message?.messageId,
    message?.wamid,
    payload?.messageId,
    payload?.id
  );

  const rawTimestamp =
    message?.timestamp ?? payload?.timestamp ?? message?.createdAt ?? payload?.createdAt;
  let timestamp = new Date().toISOString();
  if (rawTimestamp != null) {
    const num = Number(rawTimestamp);
    if (Number.isFinite(num) && num > 0) {
      // Accept unix seconds or milliseconds
      timestamp = new Date(num > 1e12 ? num : num * 1000).toISOString();
    } else {
      const parsed = new Date(String(rawTimestamp));
      if (!Number.isNaN(parsed.getTime())) timestamp = parsed.toISOString();
    }
  }

  const channelId = firstString(
    payload?.channelId,
    payload?.channel_id,
    payload?.channel?.id,
    payload?.accountId,
    payload?.account_id,
    payload?.locationId,
    message?.channelId
  );

  const msgType = firstString(message?.messageType, message?.mediaType, "text");

  return {
    phone,
    pushName,
    body,
    messageId,
    timestamp,
    channelId,
    msgType,
    direction: detectDirection(payload, message),
  };
}

async function resolveTenantByChannelId(supabase, channelId) {
  if (channelId) {
    const { data } = await supabase
      .from("tenants")
      .select("id, name, whautomate_channel_id")
      .eq("whautomate_channel_id", channelId)
      .maybeSingle();
    if (data) return data;
  }

  // Fallback: first tenant with a whautomate_channel_id configured
  const { data: fallback } = await supabase
    .from("tenants")
    .select("id, name, whautomate_channel_id")
    .not("whautomate_channel_id", "is", null)
    .limit(1);

  if (fallback?.[0]) {
    console.warn(
      `Whautomate webhook: channel id ${channelId || "(none)"} not matched, falling back to tenant ${fallback[0].id}`
    );
    return fallback[0];
  }

  return null;
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

    const tenant = await resolveTenantByChannelId(supabase, mapped.channelId);
    if (!tenant) {
      console.warn("Whautomate webhook: no tenant with whautomate_channel_id configured");
      return Response.json({ ok: true, ingested: false, reason: "no_tenant" });
    }

    const waId = normalizeWaId(mapped.phone);
    if (!waId) {
      return Response.json({ ok: true, ingested: false, reason: "invalid_phone" });
    }

    const lead = await upsertLead({
      supabase,
      tenantId: tenant.id,
      waId,
      pushName: mapped.pushName,
      messageAt: mapped.timestamp,
    });

    const waMessageId = mapped.messageId || `whautomate-${waId}-${mapped.timestamp}`;

    await insertMessageIfNew({
      supabase,
      tenantId: tenant.id,
      leadId: lead.id,
      waMessageId,
      direction: mapped.direction,
      body: mapped.body,
      msgType: mapped.msgType,
      mediaId: null,
      timestamp: mapped.timestamp,
      raw: payload,
    });

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

import { timingSafeEqual } from "@/lib/security/timing-safe";
import { maskPhone, normalizePhone } from "@/lib/leads/normalize";
import { dialOrQueueLead, getTenantBySlug, upsertPixxiLead } from "@/lib/leads/pixxi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function verifyInboundSecret(request) {
  const expected = process.env.LEADS_INBOUND_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("x-leads-secret");
  return timingSafeEqual(provided, expected);
}

export async function POST(request) {
  try {
    if (!verifyInboundSecret(request)) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(body?.phone);

    if (!phone) {
      return Response.json({ ok: false, reason: "Missing or invalid phone" });
    }

    const tenant = await getTenantBySlug("1416");
    const lead = await upsertPixxiLead(tenant.id, body);
    const result = await dialOrQueueLead({ tenant, lead, fields: body });

    console.log(
      `[leads/inbound] lead=${lead.id} phone=${maskPhone(phone)} queued=${Boolean(result.queued)} callId=${result.callId || "n/a"}`
    );

    return Response.json({
      ok: true,
      leadId: lead.id,
      queued: Boolean(result.queued),
      callId: result.callId || null,
      scheduledFor: result.scheduledFor || null,
    });
  } catch (error) {
    console.error("[leads/inbound] error:", error.message);
    return Response.json({ ok: false, error: error.message });
  }
}

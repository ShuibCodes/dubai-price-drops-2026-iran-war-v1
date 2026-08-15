import { timingSafeEqual } from "@/lib/security/timing-safe";
import { maskPhone, normalizePhone } from "@/lib/leads/normalize";
import { dialOrQueueLead, getTenantBySlug, upsertPixxiLead } from "@/lib/leads/pixxi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Slugs Zapier/inbound may target. Unknown values fall back to 1416. */
const INBOUND_TENANT_SLUGS = new Set(["1416", "ghl-courses", "condo-city", "sterling"]);
const DEFAULT_TENANT_SLUG = "1416";

function verifyInboundSecret(request) {
  const expected = process.env.LEADS_INBOUND_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("x-leads-secret");
  return timingSafeEqual(provided, expected);
}

function resolveInboundTenantSlug(request, body) {
  const fromHeader = String(request.headers.get("x-tenant-slug") || "").trim();
  const fromBody = String(body?.tenant || body?.tenant_slug || "").trim();
  const slug = (fromHeader || fromBody || DEFAULT_TENANT_SLUG).toLowerCase();
  if (!INBOUND_TENANT_SLUGS.has(slug)) {
    throw new Error(
      `Unsupported tenant "${slug}". Use one of: ${[...INBOUND_TENANT_SLUGS].join(", ")}`
    );
  }
  return slug;
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

    const tenantSlug = resolveInboundTenantSlug(request, body);
    const tenant = await getTenantBySlug(tenantSlug);
    const lead = await upsertPixxiLead(tenant.id, body);
    // ghl-courses: always dial now (no overnight queue) so opt-ins ring within ~60s of Zap.
    const immediate = tenantSlug === "ghl-courses";
    const result = await dialOrQueueLead({ tenant, lead, fields: body, immediate });

    console.log(
      `[leads/inbound] tenant=${tenantSlug} lead=${lead.id} phone=${maskPhone(phone)} immediate=${immediate} queued=${Boolean(result.queued)} callId=${result.callId || "n/a"}`
    );

    return Response.json({
      ok: true,
      tenant: tenantSlug,
      leadId: lead.id,
      immediate,
      queued: Boolean(result.queued),
      callId: result.callId || null,
      scheduledFor: result.scheduledFor || null,
    });
  } catch (error) {
    console.error("[leads/inbound] error:", error.message);
    return Response.json({ ok: false, error: error.message });
  }
}

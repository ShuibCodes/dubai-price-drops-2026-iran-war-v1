import { timingSafeEqual } from "@/lib/security/timing-safe";
import { maskPhone, normalizePhone } from "@/lib/leads/normalize";
import { dialOrQueueLead, getTenantBySlug, upsertInboundLead } from "@/lib/leads/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Slugs Zapier/inbound may target. Missing slug is 400 — never default a tenant. */
const INBOUND_TENANT_SLUGS = new Set(["1416", "ghl-courses", "condo-city", "sterling"]);

function verifyInboundSecret(request) {
  const expected = process.env.LEADS_INBOUND_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("x-leads-secret");
  return timingSafeEqual(provided, expected);
}

function resolveInboundTenantSlug(request, body) {
  const fromHeader = String(request.headers.get("x-tenant-slug") || "").trim();
  const fromBody = String(body?.tenant || body?.tenant_slug || "").trim();
  const slug = (fromHeader || fromBody).toLowerCase();
  if (!slug) {
    return {
      error: "tenant slug is required (header x-tenant-slug or body.tenant)",
    };
  }
  if (!INBOUND_TENANT_SLUGS.has(slug)) {
    return {
      error: `Unsupported tenant "${slug}". Use one of: ${[...INBOUND_TENANT_SLUGS].join(", ")}`,
    };
  }
  return { slug };
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

    const resolved = resolveInboundTenantSlug(request, body);
    if (resolved.error) {
      return Response.json({ ok: false, error: resolved.error }, { status: 400 });
    }
    const tenantSlug = resolved.slug;

    const tenant = await getTenantBySlug(tenantSlug);
    const lead = await upsertInboundLead(tenant.id, body);
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

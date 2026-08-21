import { consoleContext, jsonError, loadConsoleTenant } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROFILE_COLS =
  "id, name, team, areas, ticket_min, ticket_max, languages, brief_enabled, brief_time, tz, onboarded_at, wa_id";

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function intOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const [{ data: agent, error }, tenant] = await Promise.all([
      supabase
        .from("agents")
        .select(PROFILE_COLS)
        .eq("id", session.agentId)
        .eq("tenant_id", session.tenantId)
        .maybeSingle(),
      loadConsoleTenant(supabase, session.tenantId),
    ]);
    if (error) throw new Error(`Profile lookup failed: ${error.message}`);

    const { data: docs } = await supabase
      .from("kb_documents")
      .select("id, filename, scope, owner_agent_id, index_status, bytes")
      .eq("tenant_id", session.tenantId)
      .eq("scope", "tenant")
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: hidden } = await supabase
      .from("kb_doc_hidden")
      .select("doc_id")
      .eq("agent_id", session.agentId)
      .eq("tenant_id", session.tenantId);

    const hiddenIds = new Set((hidden || []).map((row) => row.doc_id));

    return Response.json({
      agent,
      tenant: {
        display_phone: tenant?.display_phone || null,
        whatsapp_connected: Boolean(
          tenant?.waba_id && tenant?.phone_number_id && tenant?.business_token
        ),
      },
      inherited_docs: (docs || []).map((doc) => ({
        ...doc,
        hidden: hiddenIds.has(doc.id),
      })),
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

export async function PATCH(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const body = await request.json().catch(() => ({}));

    const patch = {};
    if (body.name != null) patch.name = String(body.name).trim() || null;
    if (body.team != null) patch.team = String(body.team).trim() || null;
    if (body.areas != null) patch.areas = parseList(body.areas);
    if (body.languages != null) patch.languages = parseList(body.languages);
    if (body.ticket_min !== undefined) patch.ticket_min = intOrNull(body.ticket_min);
    if (body.ticket_max !== undefined) patch.ticket_max = intOrNull(body.ticket_max);
    if (body.brief_enabled != null) patch.brief_enabled = Boolean(body.brief_enabled);
    if (body.brief_time != null) {
      const time = String(body.brief_time).slice(0, 5);
      if (/^\d{2}:\d{2}$/.test(time)) patch.brief_time = time;
    }
    if (body.tz != null) patch.tz = String(body.tz).trim() || "Asia/Dubai";
    if (body.onboarded === true) patch.onboarded_at = new Date().toISOString();

    if (!Object.keys(patch).length) {
      return jsonError("Nothing to update.", 400);
    }

    const { data, error } = await supabase
      .from("agents")
      .update(patch)
      .eq("id", session.agentId)
      .eq("tenant_id", session.tenantId)
      .select(PROFILE_COLS)
      .single();
    if (error) throw new Error(`Profile update failed: ${error.message}`);
    return Response.json({ agent: data });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

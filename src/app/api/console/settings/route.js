import {
  consoleContext,
  jsonError,
  loadConsoleTenant,
  whatsappHealthy,
} from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const [tenant, { data: agent, error: agentError }] = await Promise.all([
      loadConsoleTenant(supabase, session.tenantId),
        supabase
          .from("agents")
          .select("id, name, wa_id, brief_enabled, brief_time, tz")
          .eq("id", session.agentId)
          .eq("tenant_id", session.tenantId)
          .maybeSingle(),
      ]);
    if (agentError) throw new Error(agentError.message);

    return Response.json({
      number: tenant?.display_phone || null,
      whatsapp_healthy: whatsappHealthy(tenant),
      role: session.role,
      agent,
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
    if (body.brief_enabled != null) patch.brief_enabled = Boolean(body.brief_enabled);
    if (body.brief_time != null && /^\d{2}:\d{2}$/.test(String(body.brief_time).slice(0, 5))) {
      patch.brief_time = String(body.brief_time).slice(0, 5);
    }
    if (body.tz != null) patch.tz = String(body.tz).trim() || "Asia/Dubai";
    if (!Object.keys(patch).length) return jsonError("Nothing to update.", 400);

    const { data, error } = await supabase
      .from("agents")
      .update(patch)
      .eq("id", session.agentId)
      .eq("tenant_id", session.tenantId)
      .select("id, name, wa_id, brief_enabled, brief_time, tz")
      .single();
    if (error) throw new Error(error.message);
    return Response.json({ agent: data });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

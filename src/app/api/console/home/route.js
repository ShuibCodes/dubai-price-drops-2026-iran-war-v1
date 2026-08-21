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

    const [tenant, { data: agent, error: agentError }, { data: runs, error: runsError }] =
      await Promise.all([
        loadConsoleTenant(supabase, session.tenantId),
        supabase
          .from("agents")
          .select(
            "id, name, brief_enabled, brief_time, tz, onboarded_at, wa_id, team, areas"
          )
          .eq("id", session.agentId)
          .eq("tenant_id", session.tenantId)
          .maybeSingle(),
        supabase
          .from("call_batches")
          .select(
            "id, status, source_type, created_at, counts, est_cost_aed, script_id, scripts(display_name)"
          )
          .eq("tenant_id", session.tenantId)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

    if (agentError) throw new Error(`Agent lookup failed: ${agentError.message}`);
    if (runsError) throw new Error(`Runs lookup failed: ${runsError.message}`);

    return Response.json({
      tenant: {
        slug: tenant?.slug,
        name: tenant?.name,
        display_phone: tenant?.display_phone || null,
        whatsapp_healthy: whatsappHealthy(tenant),
      },
      agent: {
        name: agent?.name || null,
        brief_enabled: agent?.brief_enabled !== false,
        brief_time: agent?.brief_time || "07:30",
        tz: agent?.tz || "Asia/Dubai",
        onboarded_at: agent?.onboarded_at || null,
        wa_id: agent?.wa_id || null,
      },
      runs: (runs || []).map((row) => ({
        id: row.id,
        status: row.status,
        source_type: row.source_type,
        created_at: row.created_at,
        counts: row.counts || {},
        est_cost_aed: row.est_cost_aed,
        script_id: row.script_id,
        script_name: row.scripts?.display_name || "Untitled script",
      })),
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

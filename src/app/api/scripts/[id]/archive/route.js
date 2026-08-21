import {
  jsonError,
  loadTenantScript,
  migratedWriteBlocked,
  publicScript,
  routeId,
  SCRIPT_ROW_COLS,
  scriptsContext,
} from "@/lib/scripts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const ctx = await scriptsContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const loaded = await loadTenantScript(supabase, session, await routeId(params));
    if (loaded.response) return loaded.response;
    const { script } = loaded;
    if (script.status === "archived") {
      return jsonError("Script is already archived.", 409);
    }
    const migratedBlock = migratedWriteBlocked(script);
    if (migratedBlock) return migratedBlock;

    const { count, error: queueError } = await supabase
      .from("call_queue")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("script_id", script.id)
      .eq("processed", false);
    if (queueError) throw new Error(`Queue check failed: ${queueError.message}`);
    if ((count || 0) > 0) {
      return jsonError("Cannot archive a script with unprocessed queued calls.", 409);
    }

    const { data, error } = await supabase
      .from("scripts")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", script.id)
      .eq("tenant_id", session.tenantId)
      .neq("status", "archived")
      .select(SCRIPT_ROW_COLS)
      .single();
    if (error) throw new Error(`Archive failed: ${error.message}`);

    return Response.json({ script: publicScript(data) });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

import {
  isUniqueViolation,
  jsonError,
  loadTenant,
  loadTenantScript,
  migratedWriteBlocked,
  normalizeDisplayName,
  publicScript,
  publicVersion,
  routeId,
  SCRIPT_ROW_COLS,
  SCRIPT_TEST_SOURCE,
  scriptRunCounts,
  scriptsContext,
} from "@/lib/scripts/http";
import { upsertDraftVersion } from "@/lib/scripts/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const ctx = await scriptsContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const loaded = await loadTenantScript(supabase, session, await routeId(params));
    if (loaded.response) return loaded.response;
    const { script } = loaded;
    if (script.is_migrated) {
      return jsonError("Script not found.", 404);
    }

    const { data: versions, error } = await supabase
      .from("script_versions")
      .select(
        "id, script_id, version_no, config_json, published_at, published_by, created_at, scripts!inner(tenant_id)"
      )
      .eq("script_id", script.id)
      .eq("scripts.tenant_id", session.tenantId)
      .order("version_no", { ascending: false })
      .limit(5);
    if (error) throw new Error(`Version list failed: ${error.message}`);

    const publisherIds = [
      ...new Set(
        (versions || []).map((row) => row.published_by).filter(Boolean)
      ),
    ];
    let names = {};
    if (publisherIds.length) {
      const { data: agents, error: agentError } = await supabase
        .from("agents")
        .select("id, name, username")
        .eq("tenant_id", session.tenantId)
        .in("id", publisherIds);
      if (agentError) throw new Error(`Publisher lookup failed: ${agentError.message}`);
      names = Object.fromEntries(
        (agents || []).map((agent) => [
          agent.id,
          agent.name || agent.username || "Unknown",
        ])
      );
    }

    const versionIds = (versions || []).map((row) => row.id);
    let versionRuns = {};
    if (versionIds.length) {
      const { data: callRows, error: callError } = await supabase
        .from("calls")
        .select("script_version_id")
        .eq("tenant_id", session.tenantId)
        .in("script_version_id", versionIds)
        .or(`source.is.null,source.neq.${SCRIPT_TEST_SOURCE}`);
      if (callError) throw new Error(`Version run count failed: ${callError.message}`);
      for (const row of callRows || []) {
        const id = row.script_version_id;
        if (!id) continue;
        versionRuns[id] = (versionRuns[id] || 0) + 1;
      }
    }

    const counts = await scriptRunCounts(supabase, session.tenantId, [script.id]);
    return Response.json({
      script: publicScript(script, counts[script.id]),
      versions: (versions || []).map((row) => ({
        ...publicVersion(row),
        published_by_name: names[row.published_by] || null,
        runs: versionRuns[row.id] || 0,
      })),
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

export async function PATCH(request, { params }) {
  try {
    const ctx = await scriptsContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const loaded = await loadTenantScript(supabase, session, await routeId(params));
    if (loaded.response) return loaded.response;
    const { script } = loaded;
    if (script.status === "archived") {
      return jsonError("Archived scripts cannot be edited.", 409);
    }
    const migratedBlock = migratedWriteBlocked(script);
    if (migratedBlock) return migratedBlock;

    const body = await request.json().catch(() => ({}));
    const nextName = body.display_name != null || body.name != null
      ? normalizeDisplayName(body.display_name ?? body.name)
      : null;
    if (nextName !== null && !nextName) {
      return jsonError("display_name cannot be empty.", 400);
    }

    let current = script;
    if (nextName && nextName !== script.display_name) {
      const { data, error } = await supabase
        .from("scripts")
        .update({ display_name: nextName, updated_at: new Date().toISOString() })
        .eq("id", script.id)
        .eq("tenant_id", session.tenantId)
        .neq("status", "archived")
        .select(SCRIPT_ROW_COLS)
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          return jsonError("A script with that name already exists.", 409);
        }
        throw new Error(`Script rename failed: ${error.message}`);
      }
      current = data;
    }

    if (body.config == null) {
      if (nextName === null) {
        return jsonError("config is required.", 400);
      }
      const counts = await scriptRunCounts(supabase, session.tenantId, [current.id]);
      return Response.json({ script: publicScript(current, counts[current.id]) });
    }

    const tenantLoaded = await loadTenant(supabase, session.tenantId);
    if (tenantLoaded.response) return tenantLoaded.response;

    const saved = await upsertDraftVersion({
      supabase,
      script: current,
      tenant: tenantLoaded.tenant,
      config: body.config,
    });
    if (saved.response) return saved.response;

    const { error: touchError } = await supabase
      .from("scripts")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("tenant_id", session.tenantId);
    if (touchError) {
      throw new Error(`Script touch failed: ${touchError.message}`);
    }

    const counts = await scriptRunCounts(supabase, session.tenantId, [current.id]);
    return Response.json({
      script: publicScript(current, counts[current.id]),
      version: publicVersion(saved.version),
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

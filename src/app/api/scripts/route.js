import { goalLabel, voiceLabel } from "@/lib/scripts/display";
import {
  isUniqueViolation,
  jsonError,
  MAX_LIVE_SCRIPTS,
  normalizeDisplayName,
  publicScript,
  SCRIPT_ROW_COLS,
  scriptRunCounts,
  scriptsContext,
} from "@/lib/scripts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function latestConfigByScript(supabase, tenantId, scriptIds) {
  const ids = (scriptIds || []).filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from("script_versions")
    .select("script_id, version_no, config_json, scripts!inner(tenant_id)")
    .in("script_id", ids)
    .eq("scripts.tenant_id", tenantId)
    .order("version_no", { ascending: false });
  if (error) throw new Error(`Version list failed: ${error.message}`);
  const map = {};
  for (const row of data || []) {
    if (map[row.script_id]) continue;
    map[row.script_id] = row.config_json || {};
  }
  return map;
}

export async function GET(request) {
  try {
    const ctx = await scriptsContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const { data, error } = await supabase
      .from("scripts")
      .select(SCRIPT_ROW_COLS)
      .eq("tenant_id", session.tenantId)
      .eq("is_migrated", false)
      .neq("status", "archived")
      .order("display_name", { ascending: true });
    if (error) throw new Error(`Script list failed: ${error.message}`);

    const rows = data || [];
    const ids = rows.map((row) => row.id);
    const [counts, configs] = await Promise.all([
      scriptRunCounts(supabase, session.tenantId, ids),
      latestConfigByScript(supabase, session.tenantId, ids),
    ]);
    return Response.json({
      scripts: rows.map((row) => {
        const config = configs[row.id] || {};
        return {
          ...publicScript(row, counts[row.id]),
          goal: config.goal || null,
          voice_id: config.voice_id || null,
          goal_label: config.goal ? goalLabel(config.goal) : null,
          voice_label: config.voice_id ? voiceLabel(config.voice_id) : null,
        };
      }),
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

export async function POST(request) {
  try {
    const ctx = await scriptsContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const body = await request.json().catch(() => ({}));
    const displayName = normalizeDisplayName(body.display_name ?? body.name);
    if (!displayName) {
      return jsonError("display_name is required.", 400);
    }

    const { count, error: countError } = await supabase
      .from("scripts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("is_seeded", false)
      .neq("status", "archived");
    if (countError) throw new Error(`Script count failed: ${countError.message}`);
    if ((count || 0) >= MAX_LIVE_SCRIPTS) {
      return jsonError(`A tenant can have at most ${MAX_LIVE_SCRIPTS} scripts.`, 409);
    }

    const { data, error } = await supabase
      .from("scripts")
      .insert({
        tenant_id: session.tenantId,
        display_name: displayName,
        status: "draft",
        current_version: 0,
        is_seeded: false,
        created_by: session.agentId,
      })
      .select(SCRIPT_ROW_COLS)
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        return jsonError("A script with that name already exists.", 409);
      }
      throw new Error(`Script create failed: ${error.message}`);
    }

    return Response.json(publicScript(data), { status: 201 });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

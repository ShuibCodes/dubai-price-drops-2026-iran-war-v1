import { getSession } from "@/lib/copilot/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const SCRIPT_TEST_SOURCE = "script-test";
export const SCRIPT_ROW_COLS =
  "id, tenant_id, display_name, vapi_assistant_id, status, current_version, is_seeded, is_migrated, seed_key, created_by, created_at, updated_at";

export const MAX_LIVE_SCRIPTS = 5;

export function jsonError(error, status, extra = {}) {
  return Response.json({ error, ...extra }, { status });
}

export async function scriptsContext(request) {
  let session;
  try {
    session = await getSession(request);
  } catch (error) {
    if (error.status === 403) {
      return { response: jsonError("Forbidden for this tenant.", 403) };
    }
    throw error;
  }
  if (!session) {
    return { response: jsonError("Unauthorized", 401) };
  }
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { response: jsonError("Supabase not configured", 500) };
  }
  return { session, supabase };
}

export async function requireAdmin(ctx) {
  if (ctx.session.role !== "admin") {
    return jsonError("Publishing requires an admin.", 403);
  }
  return null;
}

export async function routeId(params) {
  const resolved = typeof params?.then === "function" ? await params : params;
  return String(resolved?.id || "").trim();
}

export async function loadTenantScript(supabase, session, id) {
  if (!id) return { response: jsonError("Script id is required.", 400) };

  const { data, error } = await supabase
    .from("scripts")
    .select(SCRIPT_ROW_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Script lookup failed: ${error.message}`);
  if (!data) return { response: jsonError("Script not found.", 404) };
  if (data.tenant_id !== session.tenantId) {
    return { response: jsonError("Forbidden for this tenant.", 403) };
  }
  return { script: data };
}

export async function loadTenant(supabase, tenantId) {
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, name, slug, persona_name, vapi_assistant_id, vapi_phone_number_id"
    )
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  if (!data) return { response: jsonError("Tenant not found.", 404) };
  return { tenant: data };
}

export function publicScript(row, counts = {}) {
  return {
    id: row.id,
    display_name: row.display_name,
    status: row.status,
    current_version: row.current_version,
    vapi_assistant_id: row.vapi_assistant_id,
    is_seeded: row.is_seeded,
    is_migrated: Boolean(row.is_migrated),
    seed_key: row.seed_key || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    runs: counts.runs ?? 0,
    queued: counts.queued ?? 0,
  };
}

export function publicVersion(row) {
  return {
    id: row.id,
    version_no: row.version_no,
    config: row.config_json,
    published_at: row.published_at,
    published_by: row.published_by,
    created_at: row.created_at,
  };
}

export async function scriptRunCounts(supabase, tenantId, scriptIds) {
  const ids = Array.isArray(scriptIds) ? scriptIds.filter(Boolean) : [];
  if (!ids.length) return {};

  const entries = await Promise.all(
    ids.map(async (scriptId) => {
      const [{ count: runs, error: callError }, { count: queued, error: queueError }] =
        await Promise.all([
          supabase
            .from("calls")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("script_id", scriptId)
            .or(`source.is.null,source.neq.${SCRIPT_TEST_SOURCE}`),
          supabase
            .from("call_queue")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("script_id", scriptId),
        ]);
      if (callError) throw new Error(`Call count failed: ${callError.message}`);
      if (queueError) {
        throw new Error(`Queue count failed: ${queueError.message}`);
      }
      return [scriptId, { runs: runs || 0, queued: queued || 0 }];
    })
  );
  return Object.fromEntries(entries);
}

export function migratedWriteBlocked(script) {
  if (!script?.is_migrated) return null;
  return jsonError(
    "This is a live production assistant. Duplicate it as a new script to edit or publish.",
    409
  );
}

export function isUniqueViolation(error) {
  return error?.code === "23505";
}

export function normalizeDisplayName(value) {
  return String(value || "").trim();
}

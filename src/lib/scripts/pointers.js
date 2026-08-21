import {
  SEED_KEY_LIVE_COLD,
  SEED_KEY_LIVE_JARVIS,
  SEED_KEY_LIVE_META,
} from "./seed-configs.js";

const SCRIPT_POINTER_COLS =
  "id, vapi_assistant_id, current_version, seed_key, is_migrated, is_seeded, status";

export async function getSeededScript(supabase, tenantId, seedKey) {
  const key = String(seedKey || "").trim();
  if (!key) return null;
  const { data, error } = await supabase
    .from("scripts")
    .select(SCRIPT_POINTER_COLS)
    .eq("tenant_id", tenantId)
    .eq("seed_key", key)
    .neq("status", "archived")
    .maybeSingle();
  if (error) throw new Error(`Seeded script lookup failed: ${error.message}`);
  return data || null;
}

export async function publishedVersionId(supabase, tenantId, scriptId, versionNo) {
  const n = Number(versionNo) || 0;
  if (!scriptId || n < 1) return null;
  const { data, error } = await supabase
    .from("script_versions")
    .select("id, scripts!inner(tenant_id)")
    .eq("script_id", scriptId)
    .eq("version_no", n)
    .eq("scripts.tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`Script version lookup failed: ${error.message}`);
  return data?.id || null;
}

export async function scriptPointerForScript(supabase, tenantId, scriptId) {
  if (!scriptId) return { script_id: null, script_version_id: null };
  const { data, error } = await supabase
    .from("scripts")
    .select("id, current_version")
    .eq("id", scriptId)
    .eq("tenant_id", tenantId)
    .neq("status", "archived")
    .maybeSingle();
  if (error) throw new Error(`Script pointer lookup failed: ${error.message}`);
  if (!data) return { script_id: null, script_version_id: null };
  const versionId = await publishedVersionId(
    supabase,
    tenantId,
    data.id,
    data.current_version
  );
  return { script_id: data.id, script_version_id: versionId };
}

export async function scriptPointerForSource(
  supabase,
  tenantId,
  source,
  { jarvisLead = false } = {}
) {
  const src = String(source || "");
  let key = SEED_KEY_LIVE_COLD;
  if (jarvisLead || src.startsWith("jarvis-")) {
    key = SEED_KEY_LIVE_JARVIS;
  } else if (src === "meta-instant-form") {
    key = SEED_KEY_LIVE_META;
  }

  let script = await getSeededScript(supabase, tenantId, key);
  if (!script && key === SEED_KEY_LIVE_META) {
    script = await getSeededScript(supabase, tenantId, SEED_KEY_LIVE_COLD);
  }
  if (!script) return { script_id: null, script_version_id: null };

  const versionId = await publishedVersionId(
    supabase,
    tenantId,
    script.id,
    script.current_version
  );
  return { script_id: script.id, script_version_id: versionId };
}

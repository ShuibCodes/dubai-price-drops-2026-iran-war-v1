import { composePrompt, PREAMBLE_VERSION } from "./compose.js";
import {
  COLD_LIST_CONFIG,
  LIVE_ASSISTANT_SEEDS,
  SEED_SCRIPTS,
} from "./seed-configs.js";

async function findBySeedKey(supabase, tenantId, seedKey) {
  const { data, error } = await supabase
    .from("scripts")
    .select("id, seed_key, vapi_assistant_id, current_version")
    .eq("tenant_id", tenantId)
    .eq("seed_key", seedKey)
    .maybeSingle();
  if (error) throw new Error(`Seed lookup failed: ${error.message}`);
  return data || null;
}

async function insertVersion(supabase, { scriptId, config, prompt, published }) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("script_versions").insert({
    script_id: scriptId,
    version_no: 1,
    config_json: config,
    composed_prompt: prompt,
    preamble_version: PREAMBLE_VERSION,
    published_at: published ? now : null,
    published_by: null,
  });
  if (error) throw new Error(`Seed version insert failed: ${error.message}`);
}

async function seedCatalogScript(supabase, tenant, entry) {
  const existing = await findBySeedKey(supabase, tenant.id, entry.key);
  if (existing) return { key: entry.key, action: "skip" };

  const prompt = composePrompt({
    config: entry.config,
    tenant,
    script: { display_name: entry.display_name },
  });

  const { data, error } = await supabase
    .from("scripts")
    .insert({
      tenant_id: tenant.id,
      display_name: entry.display_name,
      status: "draft",
      current_version: 0,
      is_seeded: true,
      is_migrated: false,
      seed_key: entry.key,
      vapi_assistant_id: null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Catalog seed failed (${entry.key}): ${error.message}`);

  await insertVersion(supabase, {
    scriptId: data.id,
    config: entry.config,
    prompt,
    published: false,
  });
  return { key: entry.key, action: "insert" };
}

async function seedLivePointer(supabase, tenant, entry) {
  const assistantId = String(tenant[entry.column] || "").trim();
  if (!assistantId) return { key: entry.seed_key, action: "skip-empty" };

  const existing = await findBySeedKey(supabase, tenant.id, entry.seed_key);
  if (existing) {
    if (existing.vapi_assistant_id !== assistantId) {
      const { error } = await supabase
        .from("scripts")
        .update({
          vapi_assistant_id: assistantId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("tenant_id", tenant.id);
      if (error) {
        throw new Error(`Live pointer update failed (${entry.seed_key}): ${error.message}`);
      }
      return { key: entry.seed_key, action: "update-id" };
    }
    return { key: entry.seed_key, action: "skip" };
  }

  const prompt = composePrompt({
    config: COLD_LIST_CONFIG,
    tenant,
    script: { display_name: entry.display_name },
  });

  const { data, error } = await supabase
    .from("scripts")
    .insert({
      tenant_id: tenant.id,
      display_name: entry.display_name,
      status: "live",
      current_version: 1,
      is_seeded: true,
      is_migrated: true,
      seed_key: entry.seed_key,
      vapi_assistant_id: assistantId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Live pointer seed failed (${entry.seed_key}): ${error.message}`);

  await insertVersion(supabase, {
    scriptId: data.id,
    config: COLD_LIST_CONFIG,
    prompt,
    published: true,
  });
  return { key: entry.seed_key, action: "insert" };
}

/**
 * Idempotent. Catalog seeds are left alone if already present (do not clobber
 * agent edits). Live pointers refresh vapi_assistant_id from the tenant column.
 */
export async function seedTenantScripts(supabase, tenant) {
  const results = [];
  for (const entry of SEED_SCRIPTS) {
    results.push(await seedCatalogScript(supabase, tenant, entry));
  }
  for (const entry of LIVE_ASSISTANT_SEEDS) {
    results.push(await seedLivePointer(supabase, tenant, entry));
  }
  return results;
}

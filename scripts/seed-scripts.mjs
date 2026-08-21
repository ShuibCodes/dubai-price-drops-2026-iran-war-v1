import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { seedTenantScripts } from "../src/lib/scripts/seed.js";

applyEnv(loadEnvFile());

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenants, error } = await supabase
    .from("tenants")
    .select(
      "id, name, slug, persona_name, vapi_assistant_id, vapi_assistant_id_meta, vapi_assistant_id_jarvis"
    )
    .order("slug");
  if (error) throw new Error(`Tenant list failed: ${error.message}`);

  for (const tenant of tenants || []) {
    const results = await seedTenantScripts(supabase, tenant);
    console.log(
      `[seed-scripts] ${tenant.slug}`,
      results.map((row) => `${row.key}:${row.action}`).join(" ")
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

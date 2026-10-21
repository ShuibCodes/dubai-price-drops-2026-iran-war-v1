/**
 * Allocate inbound_email for tenants that do not have one.
 *
 *   node scripts/backfill-inbound-emails.mjs            plan only
 *   node scripts/backfill-inbound-emails.mjs --commit   apply
 */
import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

applyEnv(loadEnvFile());

const COMMIT = process.argv.includes("--commit");

async function main() {
  const { allocateInboundEmail, listTenantsMissingInboundEmail } = await import(
    "../src/lib/dubizzle/inbound-email.js"
  );

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const missing = await listTenantsMissingInboundEmail(supabase);
  if (!missing.length) {
    console.log("All tenants already have inbound_email.");
    return;
  }

  console.log(`${missing.length} tenant(s) missing inbound_email:`);
  for (const tenant of missing) {
    console.log(`  ${tenant.slug || tenant.id}`);
  }

  if (!COMMIT) {
    console.log("Plan only. Re-run with --commit to allocate addresses.");
    return;
  }

  for (const tenant of missing) {
    const email = await allocateInboundEmail(supabase, tenant.id);
    console.log(`  allocated ${tenant.slug || tenant.id} → ${email}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

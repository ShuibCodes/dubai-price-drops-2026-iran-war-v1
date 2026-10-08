/**
 * EGM Trading callback retries — Railway cron service, every 5 minutes
 * (Railway's minimum interval).
 * Dials due retries, dials rows the webhook never delivered, and fails calls
 * that never got an end-of-call report.
 *
 * node scripts/process-egm-callback-retries.mjs
 */
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { getEgmSupabase, processDueCallbacks } from "../src/lib/callbacks/egm.js";

applyEnv(loadEnvFile());

const supabase = getEgmSupabase();
if (!supabase) {
  console.error("[egm-retries] EGM_SUPABASE_URL / EGM_SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}

try {
  const summary = await processDueCallbacks(supabase);
  console.log("[egm-retries]", JSON.stringify(summary));
} catch (error) {
  console.error("[egm-retries] failed:", error.message);
  process.exit(1);
}

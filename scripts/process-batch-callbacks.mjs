/**
 * Railway cron worker for Jarvis Batch Callback.
 *
 * Mirror of process-call-queue.mjs hosting model: run this script directly
 * on a dedicated Railway service with Cron Schedule every 2 minutes UTC
 * (cron: star-slash-2 * * * *). No HTTP/API wrapper — Railway invokes the
 * start command on each tick.
 *
 * Daily cap: shares ONE combined DAILY_BATCH_CAP (200) with cold-batch via
 * batchDialsForDay / BATCH_QUEUE_SOURCES (includes "jarvis-batch-callback").
 * Before each dial, check batchDialsForDay >= DAILY_BATCH_CAP and defer with
 * nextDubaiSixPm() — same gate as process-call-queue.mjs.
 *
 * Full dial loop lands with the Batch Callback feature (migration 015 +
 * batch-callback modules). Until then this exits 0 after a no-op scan so
 * the cron service can be wired without failing every tick.
 */
import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import {
  DAILY_BATCH_CAP,
  batchDialsForDay,
  nextDubaiSixPm,
} from "../src/lib/calls/outbound.js";

applyEnv(loadEnvFile());

const DRY_RUN = process.argv.includes("--dry-run");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function main() {
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  // Probe: tables arrive with migration 015. Missing relation → clean no-op.
  const { data, error } = await supabase
    .from("jarvis_batch_callback_items")
    .select("id, batch_id, tenant_id, status, scheduled_for")
    .in("status", ["pending", "scheduled"])
    .lte("scheduled_for", new Date().toISOString())
    .limit(1);

  if (error) {
    const missing =
      /relation .* does not exist/i.test(error.message) ||
      error.code === "42P01" ||
      /Could not find the table/i.test(error.message);
    if (missing) {
      console.log(
        "batch_callback summary processed=0 note=schema_not_applied (noop)"
      );
      return;
    }
    throw error;
  }

  const due = Array.isArray(data) ? data.length : 0;
  if (due === 0) {
    console.log("batch_callback summary processed=0 note=no_due_items");
    return;
  }

  // Shared ceiling smoke-check (same counter cold-batch uses). Full dial
  // loop still pending — do not place calls from this stub.
  const tenantId = data[0]?.tenant_id;
  if (tenantId) {
    const dialsToday = await batchDialsForDay(supabase, tenantId);
    if (dialsToday >= DAILY_BATCH_CAP) {
      console.log(
        `batch_callback summary processed=0 due=${due} deferred_cap=${DAILY_BATCH_CAP} next=${nextDubaiSixPm().toISOString()} note=shared_daily_cap`
      );
      return;
    }
  }

  console.log(
    `batch_callback summary processed=0 due=${due} dry_run=${DRY_RUN} note=worker_logic_pending cap=${DAILY_BATCH_CAP}`
  );
}

main().catch((error) => {
  console.error(
    `batch_callback summary processed=0 fatal=${JSON.stringify(error.message)}`
  );
  process.exitCode = 1;
});

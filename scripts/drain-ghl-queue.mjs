/**
 * Keep draining ghl-courses copilot-cold-batch until empty or max ticks.
 * Usage: node --experimental-loader ./scripts/alias-loader.mjs scripts/drain-ghl-queue.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

const MAX_TICKS = Number(process.env.DRAIN_MAX_TICKS || 300);
const SLEEP_MS = Number(process.env.DRAIN_SLEEP_MS || 50_000);
process.env.CALL_QUEUE_MAX_DIALS_PER_RUN ||= "40";
process.env.CALL_QUEUE_DIAL_DELAY_MS ||= "2000";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runQueueOnce() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-loader", "./scripts/alias-loader.mjs", "scripts/process-call-queue.mjs"],
      { cwd: process.cwd(), env: process.env, stdio: "inherit" }
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function pendingCount(supabase, tenantId) {
  const { count, error } = await supabase
    .from("call_queue")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("processed", false)
    .eq("source", "copilot-cold-batch");
  if (error) throw error;
  return count || 0;
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", "ghl-courses")
    .single();
  if (error) throw error;

  console.log(`[drain] start pending=${await pendingCount(supabase, tenant.id)}`);

  for (let i = 1; i <= MAX_TICKS; i += 1) {
    console.log(`[drain] tick ${i}/${MAX_TICKS}`);
    await runQueueOnce();
    const left = await pendingCount(supabase, tenant.id);
    console.log(`[drain] pending=${left}`);
    if (left === 0) {
      console.log("[drain] complete");
      return;
    }
    await sleep(SLEEP_MS);
  }
  console.log("[drain] max ticks reached");
}

main().catch((err) => {
  console.error("[drain]", err.message);
  process.exit(1);
});

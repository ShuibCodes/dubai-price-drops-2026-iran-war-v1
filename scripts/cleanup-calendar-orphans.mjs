#!/usr/bin/env node
/**
 * Orphan Google Calendar event cleanup runner.
 *
 * Usage:
 *   node scripts/cleanup-calendar-orphans.mjs
 *   node scripts/cleanup-calendar-orphans.mjs --dry-run
 *   node scripts/cleanup-calendar-orphans.mjs --limit 20
 */
import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { processCalendarOrphanEvents } from "../src/lib/calendar/cleanup.js";

applyEnv(loadEnvFile());
applyEnv(loadEnvFile(".env"));

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 50 : 50;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log(`[calendar/cleanup] Running orphan cleanup (dryRun=${dryRun}, limit=${limit})...`);

try {
  const summary = await processCalendarOrphanEvents({
    supabase,
    dryRun,
    limit,
  });
  console.log("[calendar/cleanup] Completed:", JSON.stringify(summary, null, 2));
  process.exit(0);
} catch (error) {
  console.error("[calendar/cleanup] Failed:", error.message);
  process.exit(1);
}

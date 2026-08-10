/**
 * Eyeball semantic batch-callback search against live Sterling WhatsApp threads.
 *
 * Usage:
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/test-batch-callback-search.mjs "everyone who mentioned a budget"
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/test-batch-callback-search.mjs "people who asked about off-plan" --days 30
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/test-batch-callback-search.mjs --parse-only "call everyone who asked about renting in the last 3 months"
 */
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { createClient } from "@supabase/supabase-js";
import {
  BATCH_CALLBACK_CLAUDE_BATCH_SIZE,
  BATCH_CALLBACK_DEFAULT_WINDOW_DAYS,
  BATCH_CALLBACK_MATCH_LIMIT,
  BATCH_CALLBACK_MAX_THREADS_EVALUATED,
  BATCH_CALLBACK_MESSAGES_PER_THREAD,
  parseBatchCallbackCommand,
  searchBatchCallbackCandidates,
} from "../src/lib/jarvis/batch-callback-search.js";

applyEnv(loadEnvFile());

const JARVIS_TENANT_SLUG =
  String(process.env.JARVIS_TENANT_SLUG || "sterling").trim() || "sterling";

function parseArgs(argv) {
  const args = { days: null, parseOnly: false, limit: null, text: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--parse-only") {
      args.parseOnly = true;
    } else if (a === "--days") {
      args.days = Number(argv[++i]);
    } else if (a === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (a.startsWith("--days=")) {
      args.days = Number(a.slice("--days=".length));
    } else if (a.startsWith("--limit=")) {
      args.limit = Number(a.slice("--limit=".length));
    } else {
      positional.push(a);
    }
  }
  args.text = positional.join(" ").trim();
  return args;
}

async function resolveSterlingTenantId() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, name")
    .eq("slug", JARVIS_TENANT_SLUG)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Tenant slug not found: ${JARVIS_TENANT_SLUG}`);
  return data;
}

function estimateCostUsd(threadsEvaluated) {
  // Haiku 4.5 ballpark: ~1.2k input tokens/thread (20 msgs) + small output.
  // Approx $0.25 / MTok in, $1.25 / MTok out (~10× cheaper than Sonnet).
  const inputTok = threadsEvaluated * 1200;
  const outputTok = threadsEvaluated * 40;
  const usd = (inputTok / 1e6) * 0.25 + (outputTok / 1e6) * 1.25;
  return {
    inputTok,
    outputTok,
    usdLow: Number((usd * 0.7).toFixed(3)),
    usdHigh: Number((usd * 1.4).toFixed(3)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.text) {
    console.error(
      'Usage: node --experimental-loader ./scripts/alias-loader.mjs scripts/test-batch-callback-search.mjs "everyone who mentioned a budget" [--days 21]'
    );
    process.exitCode = 1;
    return;
  }

  const parsed = parseBatchCallbackCommand(args.text);
  const windowDays =
    Number.isFinite(args.days) && args.days > 0 ? args.days : parsed.windowDays;

  console.log("=== Batch callback semantic search ===");
  console.log(`raw:        ${parsed.raw}`);
  console.log(`intent:     ${parsed.intent}`);
  console.log(`windowDays: ${windowDays} (default ${BATCH_CALLBACK_DEFAULT_WINDOW_DAYS})`);
  console.log(`matchLimit: ${args.limit || BATCH_CALLBACK_MATCH_LIMIT}`);
  console.log(
    `evalCap:    ${BATCH_CALLBACK_MAX_THREADS_EVALUATED} threads × last ${BATCH_CALLBACK_MESSAGES_PER_THREAD} msgs, batches of ${BATCH_CALLBACK_CLAUDE_BATCH_SIZE}`
  );

  if (args.parseOnly) {
    console.log("\n(--parse-only: stopping before Claude search)");
    return;
  }

  const tenant = await resolveSterlingTenantId();
  console.log(`tenant:     ${tenant.slug} (${tenant.id})`);

  const started = Date.now();
  const result = await searchBatchCallbackCandidates({
    tenantId: tenant.id,
    intent: parsed.intent,
    windowDays,
    limit: args.limit || BATCH_CALLBACK_MATCH_LIMIT,
    onProgress: (info) => {
      if (info.phase === "prefilter") {
        console.log(
          `\nprefilter: ${info.activeThreads} active threads from ${info.scannedMessageRows} message rows since ${info.since}`
        );
      } else if (info.phase === "evaluating") {
        console.log(
          `evaluating: batches ${info.batchesDone}/${info.batchesTotal} · threads ${info.threadsEvaluated} · matches ${info.matchCount}`
        );
      }
    },
  });

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  const cost = estimateCostUsd(result.threadsEvaluated);

  console.log("\n=== Results ===");
  console.log(
    `evaluated ${result.threadsEvaluated}/${result.threadsConsidered} threads in ${elapsedSec}s · matches ${result.matches.length}${result.stoppedEarly ? " (hit match cap)" : ""}`
  );
  console.log(
    `est. Claude cost for this run: ~$${cost.usdLow}–$${cost.usdHigh} (rough; model=${result.model})`
  );
  console.log(
    `typical full 21-day Sterling window (~100 threads): about $0.02–$0.06 if all are evaluated (Haiku)`
  );

  if (!result.matches.length) {
    console.log("\n(no matches)");
    return;
  }

  for (const [i, m] of result.matches.entries()) {
    const name = m.display_name || "(unknown)";
    const phone = m.phone_e164 || m.wa_id || "?";
    const when = m.last_message_at
      ? String(m.last_message_at).slice(0, 19).replace("T", " ")
      : "?";
    console.log(`\n${i + 1}. ${name}  ${phone}`);
    console.log(`   last: ${when}`);
    console.log(`   why:  ${m.match_reason}`);
  }
}

main().catch((error) => {
  console.error("fatal:", error.message || error);
  process.exitCode = 1;
});

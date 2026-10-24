/**
 * Railway cron worker for Jarvis Batch Callback + inbound-source leads.
 *
 * Mirror of process-call-queue.mjs hosting model: run this script directly
 * on a dedicated Railway service with Cron Schedule every minute UTC
 * (cron: * * * * *). No HTTP/API wrapper — Railway invokes the
 * start command on each tick.
 *
 * Inbound sources (GHL forms, /api/inbound/[sourceId]): each tick claims
 * leads with call_status='waiting' and next_call_at <= now (waiting → calling,
 * conditional update so overlapping runs never double-dial) and dials via
 * dialLeadNow. Outcomes/retries are written by the Vapi webhook. Not counted
 * toward DAILY_BATCH_CAP (same as /api/leads/inbound dials).
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
  dialLeadNow,
  getOutboundTenant,
  nextDubaiSixPm,
} from "../src/lib/calls/outbound.js";
import { isTransientDialError } from "../src/lib/callbacks/egm.js";
import {
  INBOUND_CALL_SOURCE,
  INBOUND_STUCK_CALLING_MS,
  applyInboundCallOutcome,
} from "../src/lib/leads/inbound-sources.js";
import { getLeadTimezone } from "../src/lib/leads/phone-timezone.js";
import {
  isWithinZoneWindow,
  nextZoneWindowStart,
} from "../src/lib/calls/business-hours.js";

applyEnv(loadEnvFile());

const DRY_RUN = process.argv.includes("--dry-run");
const INBOUND_BATCH_LIMIT = Number(process.env.INBOUND_BATCH_LIMIT || 10);
const INBOUND_RETRY_DELAY_MIN = 5;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function setLead(supabase, id, values, expectedStatus) {
  let query = supabase.from("leads").update(values).eq("id", id);
  if (expectedStatus) query = query.eq("call_status", expectedStatus);
  const { error } = await query;
  if (error) throw new Error(`Lead state update failed: ${error.message}`);
}

/** Leads stuck in 'calling' (webhook never arrived) → same path as no answer. */
async function sweepStuckInboundCalls(supabase) {
  const cutoff = new Date(Date.now() - INBOUND_STUCK_CALLING_MS).toISOString();
  const { data, error } = await supabase
    .from("leads")
    .select("id, wa_id, inbound_source_id, call_status, call_attempts")
    .eq("call_status", "calling")
    .not("inbound_source_id", "is", null)
    .lte("next_call_at", cutoff)
    .limit(50);
  if (error) throw new Error(`Stuck inbound query failed: ${error.message}`);
  if (DRY_RUN) return data?.length || 0;
  for (const lead of data || []) {
    await applyInboundCallOutcome(supabase, lead, { connected: false });
  }
  return data?.length || 0;
}

async function processInboundLeads(supabase) {
  const summary = { dialed: 0, skipped: 0, deferred: 0, failed: 0, retried: 0, stuck: 0 };

  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("leads")
    .select("*, inbound_sources(*)")
    .eq("call_status", "waiting")
    .not("inbound_source_id", "is", null)
    .lte("next_call_at", nowIso)
    .order("next_call_at", { ascending: true })
    .limit(INBOUND_BATCH_LIMIT);
  if (error) {
    // Migration 029 not applied yet → no-op, like the batch-callback probe below.
    if (/does not exist|Could not find/i.test(error.message)) {
      console.log("inbound summary dialed=0 note=schema_not_applied (noop)");
      return;
    }
    throw new Error(`Inbound due query failed: ${error.message}`);
  }

  summary.stuck = await sweepStuckInboundCalls(supabase);

  const tenants = new Map();
  for (const lead of due || []) {
    const source = lead.inbound_sources;
    if (!tenants.has(lead.tenant_id)) {
      tenants.set(lead.tenant_id, await getOutboundTenant(supabase, lead.tenant_id));
    }
    const tenant = tenants.get(lead.tenant_id);

    // Kill switch: leave as waiting; it dials once the tenant is unpaused.
    if (tenant.outbound_paused) {
      summary.skipped += 1;
      continue;
    }
    if (DRY_RUN) {
      summary.skipped += 1;
      continue;
    }
    if (!source?.is_active || lead.opted_out) {
      await setLead(supabase, lead.id, { call_status: "failed", next_call_at: null }, "waiting");
      summary.failed += 1;
      continue;
    }

    // Retries/old rows can drift outside the lead-local window → push to next start.
    const phone = `+${String(lead.wa_id || "").replace(/\D/g, "")}`;
    const tz = getLeadTimezone(phone);
    if (!isWithinZoneWindow(tz, source.call_window_start, source.call_window_end)) {
      const next = nextZoneWindowStart(tz, source.call_window_start, source.call_window_end);
      await setLead(supabase, lead.id, { next_call_at: next.toISOString() }, "waiting");
      summary.deferred += 1;
      continue;
    }

    // Atomic claim: only one run can flip this exact (waiting, attempts) row.
    const attempts = lead.call_attempts || 0;
    const { data: claimed, error: claimError } = await supabase
      .from("leads")
      .update({
        call_status: "calling",
        call_attempts: attempts + 1,
        next_call_at: new Date().toISOString(),
      })
      .eq("id", lead.id)
      .eq("call_status", "waiting")
      .eq("call_attempts", attempts)
      .select("*")
      .maybeSingle();
    if (claimError) throw new Error(`Inbound claim failed: ${claimError.message}`);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    try {
      await dialLeadNow({
        supabase,
        tenant,
        lead: claimed,
        source: INBOUND_CALL_SOURCE,
        assistantIdOverride: source.assistant_id || null,
      });
      summary.dialed += 1;
    } catch (dialError) {
      const message = String(dialError.message || "Dial failed");
      if (isTransientDialError(message)) {
        // Vapi busy/5xx: release the claim and give the attempt back.
        await setLead(
          supabase,
          lead.id,
          {
            call_status: "waiting",
            call_attempts: attempts,
            next_call_at: new Date(Date.now() + INBOUND_RETRY_DELAY_MIN * 60_000).toISOString(),
          },
          "calling"
        );
        summary.retried += 1;
      } else {
        await setLead(supabase, lead.id, { call_status: "failed", next_call_at: null }, "calling");
        summary.failed += 1;
      }
      console.error(`inbound dial lead=${lead.id} error=${JSON.stringify(message)}`);
    }
  }

  console.log(
    `inbound summary due=${due?.length || 0} dialed=${summary.dialed} skipped=${summary.skipped} deferred=${summary.deferred} failed=${summary.failed} retried=${summary.retried} stuck=${summary.stuck} dry_run=${DRY_RUN}`
  );
}

async function main() {
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  await processInboundLeads(supabase);

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

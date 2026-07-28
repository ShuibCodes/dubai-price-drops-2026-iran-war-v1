import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import {
  dialLeadNow,
  getOutboundTenant,
  isLeadWithinBusinessHours,
  nextLeadWindowStart,
} from "../src/lib/calls/outbound.js";

applyEnv(loadEnvFile());

const MAX_DIALS_PER_RUN = Number(process.env.CALL_QUEUE_MAX_DIALS_PER_RUN || 30);
const DIAL_DELAY_MS = Number(process.env.CALL_QUEUE_DIAL_DELAY_MS || 1500);
const RETRY_DELAY_MIN = Number(process.env.CALL_QUEUE_RETRY_DELAY_MIN || 5);
// After this many consecutive concurrency rejections, Vapi is saturated —
// stop burning the rest of the run and let the next tick pick the queue up.
const MAX_CONSECUTIVE_CONCURRENCY_ERRORS = 3;
let runSummary = { processed: 0, skipped: 0, rescheduled: 0, failed: 0, retried: 0 };

// Vapi rejections that resolve on their own: over-concurrency (calls in
// flight) and 5xx. These rows are retried later, never permanently failed.
function isTransientDialError(message) {
  const text = String(message || "");
  return (
    /over concurrency limit/i.test(text) ||
    /\((5\d\d)\)/.test(text)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logSummary({ processed, skipped, rescheduled, failed, retried }, suffix = "") {
  console.log(
    `call_queue summary processed=${processed} skipped=${skipped} rescheduled=${rescheduled} failed=${failed} retried=${retried}${suffix}`
  );
}

async function updateQueueRow(supabase, id, values) {
  const { error } = await supabase.from("call_queue").update(values).eq("id", id);
  if (error) throw new Error(`Queue state update failed: ${error.message}`);
}

async function claimQueueRow(supabase, id) {
  const { data, error } = await supabase
    .from("call_queue")
    .update({ processing_started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("processed", false)
    .is("processing_started_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Queue claim failed: ${error.message}`);
  return Boolean(data);
}

async function main({ dryRun = false } = {}) {
  runSummary = { processed: 0, skipped: 0, rescheduled: 0, failed: 0, retried: 0 };
  const summary = runSummary;

  // No global business-hours exit: the worker runs 24/7 and each row is gated
  // in the LEAD's local timezone below (UK evening rows fire after Dubai hours).
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date().toISOString();

  const { data: queueRows, error } = await supabase
    .from("call_queue")
    .select("id, tenant_id, lead_id, jarvis_lead_id, scheduled_for, source, leads(*), jarvis_leads(*)")
    .eq("processed", false)
    .is("processing_started_at", null)
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(1000);

  if (error) throw new Error(`Queue query failed: ${error.message}`);

  if (!queueRows?.length) {
    logSummary(summary, dryRun ? " dry_run=true" : "");
    return;
  }

  let dialAttempts = 0;
  let consecutiveConcurrencyErrors = 0;

  for (const item of queueRows) {
    if (dialAttempts >= MAX_DIALS_PER_RUN) break;
    if (consecutiveConcurrencyErrors >= MAX_CONSECUTIVE_CONCURRENCY_ERRORS) {
      console.log("call_queue: Vapi concurrency saturated, ending run early");
      break;
    }

    const lead = item.jarvis_leads || item.leads;
    const jarvisLead = Boolean(item.jarvis_lead_id);
    const tenant = await getOutboundTenant(supabase, item.tenant_id);

    if (tenant.outbound_paused) {
      summary.skipped += 1;
      continue;
    }

    // Per-row gate in the LEAD's local timezone: a due row at a bad local hour
    // is pushed to the lead's next local window start instead of being dialed.
    const leadPhone = lead?.wa_id ? `+${lead.wa_id}` : null;
    if (leadPhone && !isLeadWithinBusinessHours(leadPhone)) {
      if (!dryRun) {
        await updateQueueRow(supabase, item.id, {
          scheduled_for: nextLeadWindowStart(leadPhone).toISOString(),
        });
      }
      summary.rescheduled += 1;
      continue;
    }

    if (dryRun) {
      summary.skipped += 1;
      dialAttempts += 1;
      continue;
    }

    const claimed = await claimQueueRow(supabase, item.id);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    if (!lead) {
      await updateQueueRow(supabase, item.id, {
        processed: true,
        failed_at: new Date().toISOString(),
        failure_reason: "Lead not found",
      });
      summary.failed += 1;
      continue;
    }

    if (dialAttempts > 0 && DIAL_DELAY_MS > 0) {
      await sleep(DIAL_DELAY_MS);
    }
    dialAttempts += 1;
    try {
      await dialLeadNow({
        supabase,
        tenant,
        lead,
        source: item.source || "pixxi-queue",
        jarvisLead,
      });

      await updateQueueRow(supabase, item.id, {
        processed: true,
        processed_at: new Date().toISOString(),
      });
      summary.processed += 1;
      consecutiveConcurrencyErrors = 0;
    } catch (error) {
      const message = String(error.message || "Dial failed");
      if (isTransientDialError(message)) {
        // Release the claim and push the row out so a later run retries it.
        await updateQueueRow(supabase, item.id, {
          processing_started_at: null,
          scheduled_for: new Date(
            Date.now() + RETRY_DELAY_MIN * 60 * 1000
          ).toISOString(),
          failure_reason: `retrying: ${message}`.slice(0, 1000),
        });
        summary.retried += 1;
        if (/over concurrency limit/i.test(message)) {
          consecutiveConcurrencyErrors += 1;
        }
        continue;
      }
      await updateQueueRow(supabase, item.id, {
        processed: true,
        failed_at: new Date().toISOString(),
        failure_reason: message.slice(0, 1000),
      });
      summary.failed += 1;
    }
  }

  logSummary(summary, dryRun ? " dry_run=true" : "");
}

const dryRun = process.argv.includes("--dry-run");

main({ dryRun }).catch((error) => {
  logSummary(runSummary, ` fatal=${JSON.stringify(error.message)}`);
  process.exitCode = 1;
});

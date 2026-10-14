/**
 * EGM Trading callbacks — no live DB, no Vapi HTTP.
 *
 * node scripts/qa-egm-callbacks.mjs
 */
import assert from "node:assert/strict";

process.env.EGM_VAPI_ASSISTANT_ID = "asst-egm";
process.env.EGM_VAPI_PHONE_NUMBER_ID = "num-egm";
process.env.EGM_TIMEZONE = "Europe/London";

const {
  egmCallbackRef,
  handleCallbackCallEnded,
  handleNewCallbackRequest,
  normalizeCallbackPhone,
  processDueCallbacks,
  shouldRetryCall,
  withinRetryHours,
} = await import("../src/lib/callbacks/egm.js");

/** Just enough of supabase-js for egm.js: filters, update/select, maybeSingle, await. */
function fakeSupabase(rows) {
  return {
    rows,
    from() {
      const filters = [];
      let patch = null;
      let limit = Infinity;
      const matches = (row) => filters.every((f) => f(row));
      const run = () => {
        const hit = rows.filter(matches).slice(0, limit);
        if (patch) hit.forEach((row) => Object.assign(row, patch));
        return hit.map((row) => ({ ...row }));
      };
      const builder = {
        select: () => builder,
        update: (p) => ((patch = p), builder),
        eq: (col, v) => (filters.push((r) => r[col] === v), builder),
        is: (col, v) => (filters.push((r) => (r[col] ?? null) === v), builder),
        not: (col, _op, v) => (filters.push((r) => (r[col] ?? null) !== v), builder),
        lte: (col, v) => (filters.push((r) => r[col] != null && r[col] <= v), builder),
        lt: (col, v) => (filters.push((r) => r[col] != null && r[col] < v), builder),
        order: () => builder,
        limit: (n) => ((limit = n), builder),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve) => resolve({ data: run(), error: null }),
      };
      return builder;
    },
  };
}

function fakeDial(failures = []) {
  const calls = [];
  const dial = async (args) => {
    const failure = failures.shift();
    if (failure) throw new Error(failure);
    calls.push(args);
    return { callId: `call-${calls.length}` };
  };
  return { calls, dial };
}

const BUSY = "Vapi call start failed (400): Over Concurrency Limit";
const noWait = async () => {};
const at = (iso) => () => new Date(iso);
const newRow = (over = {}) => ({
  id: "req-1",
  name: "Sam",
  phone_e164: "+447700900123",
  vehicle: "2019 Audi A4",
  status: "pending",
  requested_at: "2026-10-08T10:00:00.000Z",
  attempts: 0,
  next_retry_at: null,
  call_placed_at: null,
  ...over,
});
const ended = (callId, endedReason, extra = {}) => ({
  callId,
  endedReason,
  endedAt: extra.endedAt || "2026-10-08T10:01:00.000Z",
  summary: extra.summary || "",
  structuredData: extra.structuredData || null,
});

// Phone numbers: UK and UAE locals must not be confused.
for (const [input, expected] of [
  ["07700 900123", "+447700900123"],
  ["+44 (0)7700 900123", "+447700900123"],
  ["0044 7700 900123", "+447700900123"],
  ["447700900123", "+447700900123"],
  ["020 7946 0000", "+442079460000"],
  ["050 123 4567", "+971501234567"],
  ["501234567", "+971501234567"],
  ["+971 50 123 4567", "+971501234567"],
  ["+971 050 123 4567", "+971501234567"],
  ["04 123 4567", "+97141234567"],
  ["+1 415 555 0100", "+14155550100"],
  ["97150123", null],
  ["4155550100", null],
  ["12345", null],
  ["", null],
]) {
  assert.equal(normalizeCallbackPhone(input), expected, `phone ${JSON.stringify(input)}`);
}

// Retry hours: 21:30 London (BST) moves to 09:00 next day; 13:15 stays.
assert.equal(withinRetryHours(new Date("2026-10-08T20:30:00Z")).toISOString(), "2026-10-09T08:00:00.000Z");
assert.equal(withinRetryHours(new Date("2026-10-08T12:15:00Z")).toISOString(), "2026-10-08T12:15:00.000Z");

// Which ended reasons get another go.
assert.equal(shouldRetryCall({ endedReason: "customer-did-not-answer" }), true);
assert.equal(shouldRetryCall({ endedReason: "voicemail" }), true);
assert.equal(shouldRetryCall({ endedReason: "twilio-failed-to-connect-call" }), true);
assert.equal(shouldRetryCall({ endedReason: "call.in-progress.error-providerfault-transport-never-connected" }), true);
assert.equal(shouldRetryCall({ endedReason: "customer-ended-call" }), false);
assert.equal(shouldRetryCall({ endedReason: "exceeded-max-duration" }), false);
assert.equal(shouldRetryCall({ endedReason: "pipeline-error-openai-llm-failed", structuredData: { reached: true } }), false);

// Webhook matching: by our variableValues tag, or by the EGM assistant id.
assert.deepEqual(
  egmCallbackRef({ message: { call: { assistantOverrides: { variableValues: { callSource: "egm-callback", callbackRequestId: "req-9" } } } } }),
  { callbackRequestId: "req-9" }
);
assert.deepEqual(egmCallbackRef({ message: { call: { assistantId: "asst-egm" } } }), { callbackRequestId: null });
assert.equal(egmCallbackRef({ message: { call: { assistantId: "asst-1416" } } }), null);

// New request: claimed, dialled once, timestamps written.
{
  const db = fakeSupabase([newRow()]);
  const vapi = fakeDial();
  const result = await handleNewCallbackRequest(db, newRow(), { dial: vapi.dial, now: at("2026-10-08T10:00:02Z") });
  assert.equal(result.ok, true);
  assert.equal(vapi.calls.length, 1);
  const call = vapi.calls[0];
  assert.equal(call.phone, "+447700900123");
  assert.equal(call.assistantId, "asst-egm");
  assert.equal(call.phoneNumberId, "num-egm");
  assert.equal(call.variableValues.callSource, "egm-callback");
  assert.equal(call.variableValues.callbackRequestId, "req-1");
  const row = db.rows[0];
  assert.equal(row.status, "calling");
  assert.equal(row.call_placed_at, "2026-10-08T10:00:02.000Z");
  assert.equal(row.vapi_call_id, "call-1");
  assert.equal(row.attempts, 1);

  // Same webhook delivered twice: no second call.
  const again = await handleNewCallbackRequest(db, newRow(), { dial: vapi.dial });
  assert.equal(again.skipped, true);
  assert.equal(vapi.calls.length, 1);
}

// Answered: report then a late status-update must not blank the summary or reopen the row.
{
  const db = fakeSupabase([newRow({ status: "calling", attempts: 1, vapi_call_id: "call-1" })]);
  await handleCallbackCallEnded(db, ended("call-1", "customer-ended-call", {
    summary: "Wants a test drive Saturday morning.",
    structuredData: { reached: true, interested: true, next_step: "test_drive" },
    endedAt: "2026-10-08T10:02:30.000Z",
  }));
  await handleCallbackCallEnded(db, ended("call-1", "call.in-progress.error-vapifault-transport-connected-but-call-not-active"));
  const row = db.rows[0];
  assert.equal(row.status, "called");
  assert.equal(row.summary, "Wants a test drive Saturday morning.");
  assert.equal(row.outcome.next_step, "test_drive");
  assert.equal(row.call_ended_at, "2026-10-08T10:02:30.000Z");
  assert.equal(row.next_retry_at ?? null, null);
}

// Answered: status-update first (no data), then the report fills summary/outcome.
{
  const db = fakeSupabase([newRow({ status: "calling", attempts: 1, vapi_call_id: "call-1" })]);
  await handleCallbackCallEnded(db, ended("call-1", "customer-ended-call"));
  assert.equal(db.rows[0].status, "called");
  await handleCallbackCallEnded(db, ended("call-1", "customer-ended-call", {
    summary: "Not interested any more.",
    structuredData: { reached: true, interested: false, next_step: "not_interested" },
  }));
  assert.equal(db.rows[0].summary, "Not interested any more.");
  assert.equal(db.rows[0].outcome.interested, false);
}

// No answer → retry +10 min → retry +60 min → failed after 3 attempts.
{
  const db = fakeSupabase([newRow()]);
  const vapi = fakeDial();
  await handleNewCallbackRequest(db, newRow(), { dial: vapi.dial, now: at("2026-10-08T10:00:02Z") });

  const noAnswer = (callId, endedAt) =>
    handleCallbackCallEnded(db, ended(callId, "customer-did-not-answer", { endedAt }), { now: at(endedAt) });

  await noAnswer("call-1", "2026-10-08T10:00:40.000Z");
  assert.equal(db.rows[0].status, "pending");
  assert.equal(db.rows[0].next_retry_at, "2026-10-08T10:10:40.000Z");
  // The second end event for the same call keeps the same retry time.
  await noAnswer("call-1", "2026-10-08T10:00:41.000Z");
  assert.equal(db.rows[0].next_retry_at, "2026-10-08T10:10:40.000Z");

  let summary = await processDueCallbacks(db, { dial: vapi.dial, now: at("2026-10-08T10:05:00Z") });
  assert.equal(summary.retried, 0);

  summary = await processDueCallbacks(db, { dial: vapi.dial, now: at("2026-10-08T10:15:00Z") });
  assert.equal(summary.retried, 1);
  assert.equal(vapi.calls.length, 2);
  assert.equal(db.rows[0].attempts, 2);
  assert.equal(db.rows[0].status, "calling");
  // 60s metric keeps the first attempt.
  assert.equal(db.rows[0].call_placed_at, "2026-10-08T10:00:02.000Z");

  // A late report for call-1 found via the row id hint must not touch call-2.
  const stale = await handleCallbackCallEnded(
    db,
    { callId: "call-1-unknown", endedReason: "customer-did-not-answer" },
    { callbackRequestId: "req-1" }
  );
  assert.equal(stale.reason, "stale-call");

  await noAnswer("call-2", "2026-10-08T10:15:40.000Z");
  assert.equal(db.rows[0].next_retry_at, "2026-10-08T11:15:40.000Z");

  await processDueCallbacks(db, { dial: vapi.dial, now: at("2026-10-08T11:20:00Z") });
  assert.equal(db.rows[0].attempts, 3);
  await noAnswer("call-3", "2026-10-08T11:20:40.000Z");
  assert.equal(db.rows[0].status, "failed");
  assert.equal(db.rows[0].next_retry_at, null);
  assert.equal(vapi.calls.length, 3);
}

// Vapi busy on a new request: retried inside the webhook, still one attempt.
{
  const db = fakeSupabase([newRow()]);
  const vapi = fakeDial([BUSY, BUSY]);
  const result = await handleNewCallbackRequest(db, newRow(), { dial: vapi.dial, wait: noWait, now: at("2026-10-08T10:00:08Z") });
  assert.equal(result.ok, true);
  assert.equal(db.rows[0].attempts, 1);
  assert.equal(db.rows[0].status, "calling");
}

// Vapi still busy after inline retries: handed to the cron without spending an attempt.
{
  const db = fakeSupabase([newRow()]);
  const vapi = fakeDial([BUSY, BUSY, BUSY]);
  const result = await handleNewCallbackRequest(db, newRow(), { dial: vapi.dial, wait: noWait, now: at("2026-10-08T10:00:08Z") });
  assert.equal(result.retry, true);
  assert.equal(db.rows[0].status, "pending");
  assert.equal(db.rows[0].attempts, 0);
  assert.equal(db.rows[0].next_retry_at, "2026-10-08T10:00:08.000Z");

  const summary = await processDueCallbacks(db, { dial: vapi.dial, now: at("2026-10-08T10:05:00Z") });
  assert.equal(summary.retried, 1);
  assert.equal(db.rows[0].status, "calling");
  assert.equal(db.rows[0].attempts, 1);
}

// Vapi busy on attempt 3 (well after the request): still retried, not failed.
{
  const row = newRow({ attempts: 2, call_placed_at: "2026-10-08T10:00:02.000Z", next_retry_at: "2026-10-08T11:15:00.000Z" });
  const db = fakeSupabase([row]);
  const vapi = fakeDial([BUSY]);
  await processDueCallbacks(db, { dial: vapi.dial, now: at("2026-10-08T11:16:00Z") });
  assert.equal(db.rows[0].status, "pending");
  assert.equal(db.rows[0].attempts, 2);
  assert.equal(db.rows[0].next_retry_at, "2026-10-08T11:15:00.000Z");
}

// Bad number: failed, never dialled.
{
  const db = fakeSupabase([newRow({ phone_e164: "12345" })]);
  const vapi = fakeDial();
  const result = await handleNewCallbackRequest(db, newRow({ phone_e164: "12345" }), { dial: vapi.dial });
  assert.equal(result.reason, "invalid-phone");
  assert.equal(db.rows[0].status, "failed");
  assert.equal(vapi.calls.length, 0);
}

// Missing setting: throws before claiming, so the row stays pending for the cron.
{
  const saved = process.env.EGM_VAPI_PHONE_NUMBER_ID;
  delete process.env.EGM_VAPI_PHONE_NUMBER_ID;
  const db = fakeSupabase([newRow()]);
  await assert.rejects(handleNewCallbackRequest(db, newRow(), { dial: fakeDial().dial }), /EGM_VAPI_PHONE_NUMBER_ID/);
  assert.equal(db.rows[0].status, "pending");
  process.env.EGM_VAPI_PHONE_NUMBER_ID = saved;
}

// Webhook never delivered: a recent row is dialled by the cron, an old one is failed.
{
  const db = fakeSupabase([
    newRow({ id: "recent", requested_at: "2026-10-08T10:00:00.000Z" }),
    newRow({ id: "old", requested_at: "2026-10-08T08:00:00.000Z" }),
    newRow({ id: "just-in", requested_at: "2026-10-08T10:04:30.000Z" }),
  ]);
  const vapi = fakeDial();
  const summary = await processDueCallbacks(db, { dial: vapi.dial, now: at("2026-10-08T10:05:00Z") });
  assert.equal(summary.missed, 1);
  assert.equal(summary.missedFailed, 1);
  const byId = Object.fromEntries(db.rows.map((r) => [r.id, r]));
  assert.equal(byId.recent.status, "calling");
  assert.equal(byId.old.status, "failed");
  assert.equal(byId.old.ended_reason, "not-dialled-in-time");
  // Under a minute old: left for the webhook.
  assert.equal(byId["just-in"].status, "pending");
}

// No end-of-call report after 15 min (or a crash after claiming): failed by the cron.
{
  const db = fakeSupabase([newRow({ status: "calling", attempts: 1, last_attempt_at: "2026-10-08T10:00:02.000Z" })]);
  const summary = await processDueCallbacks(db, { now: at("2026-10-08T10:20:00Z") });
  assert.equal(summary.stale, 1);
  assert.equal(db.rows[0].status, "failed");
  assert.equal(db.rows[0].ended_reason, "no-end-of-call-report");
}

console.log("qa-egm-callbacks: all checks passed");

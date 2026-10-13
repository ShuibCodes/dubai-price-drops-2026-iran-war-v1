import { createClient } from "@supabase/supabase-js";
import { maskPhone } from "../leads/normalize.js";
import { startLeadCall } from "../vapi/dial.js";

/**
 * EGM Trading website callbacks.
 *
 * The client's Supabase owns `callback_requests` (form + schema are Said's side).
 * A Database Webhook on INSERT posts the row to /api/callbacks/egm; we claim it,
 * dial Vapi straight away, and write the call result back to the same row.
 *
 * status: pending → calling → called | failed
 * A retry puts the row back to pending with next_retry_at set; the retry cron
 * (scripts/process-egm-callback-retries.mjs, every 5 min) claims it once due.
 */

export const CALL_SOURCE = "egm-callback";
export const MAX_ATTEMPTS = 3;
/** Minutes to wait before attempt 2 and attempt 3. */
export const RETRY_DELAYS_MIN = [10, 60];
/** Vapi busy/5xx on a fresh request: retry inside the webhook before giving way to the cron. */
export const INLINE_DIAL_RETRIES = 2;
export const INLINE_DIAL_DELAY_MS = 3000;
/** Stop retrying Vapi busy/5xx once the attempt has been due this long. */
export const TRANSIENT_GIVE_UP_MIN = 30;
/** A call still `calling` this long after it was dialled is marked failed. */
export const STALE_CALL_MIN = 15;
/** A pending row the webhook never delivered: dial it if newer than this, else fail it. */
export const MISSED_WEBHOOK_MIN = { after: 1, giveUp: 60 };
/** Retries only ring inside these local hours. The first call is always immediate. */
export const RETRY_HOURS = { start: 9, end: 20 };

let cachedClient = null;

export function callbackTable() {
  return process.env.EGM_CALLBACK_TABLE || "callback_requests";
}

/** Service-role client for the client's Supabase project (not AgentZero's). */
export function getEgmSupabase() {
  const url = process.env.EGM_SUPABASE_URL;
  const key = process.env.EGM_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });
  }
  return cachedClient;
}

/** Checked before a row is claimed, so a missing setting never strands a row in `calling`. */
export function getEgmDialConfig() {
  const assistantId = String(process.env.EGM_VAPI_ASSISTANT_ID || "").trim();
  const phoneNumberId = String(process.env.EGM_VAPI_PHONE_NUMBER_ID || "").trim();
  if (!assistantId) throw new Error("Missing EGM_VAPI_ASSISTANT_ID");
  if (!phoneNumberId) throw new Error("Missing EGM_VAPI_PHONE_NUMBER_ID");
  return { assistantId, phoneNumberId };
}

function minutesFrom(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * E.164 for UK and UAE callers. AgentZero's normalizePhone reads any leading 0
 * as UAE, which turns UK 07… numbers into +9717…, so callbacks use this instead.
 * Local numbers are told apart by length: UK 0 + 10 digits, UAE 0 + 8 or 9.
 * Other countries need a + or 00 prefix.
 */
export function normalizeCallbackPhone(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    // international as given
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (/^0\d{10}$/.test(digits)) {
    digits = `44${digits.slice(1)}`;
  } else if (/^0(5\d{8}|[2-9]\d{7})$/.test(digits)) {
    digits = `971${digits.slice(1)}`;
  } else if (/^5\d{8}$/.test(digits)) {
    digits = `971${digits}`;
  } else if (!/^(44\d{10}|971\d{8,9})$/.test(digits)) {
    return null;
  }
  // Trunk 0 kept after the country code: +44 (0)7…, +971 05…
  if (/^440\d{10}$/.test(digits)) digits = `44${digits.slice(3)}`;
  if (/^9710\d{8,9}$/.test(digits)) digits = `971${digits.slice(4)}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

function localHour(date, timeZone) {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" })
    .format(date);
  return Number(hour);
}

/** Push a retry that lands outside RETRY_HOURS to the next RETRY_HOURS.start. */
export function withinRetryHours(date, timeZone = process.env.EGM_TIMEZONE || "Europe/London") {
  const hour = localHour(date, timeZone);
  if (hour >= RETRY_HOURS.start && hour < RETRY_HOURS.end) return date;
  let next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  while (localHour(next, timeZone) !== RETRY_HOURS.start) {
    next = new Date(next.getTime() + 60 * 60_000);
  }
  return next;
}

/**
 * True when the call ended without a conversation worth keeping: no answer,
 * busy, voicemail, or a carrier/Vapi error before or during connect.
 */
export function shouldRetryCall({ endedReason, structuredData } = {}) {
  if (structuredData?.reached === true) return false;
  return /did-not-answer|no-answer|busy|voicemail|failed-to-connect|never-connected|error/i.test(
    String(endedReason || "")
  );
}

export function isTransientDialError(message) {
  const text = String(message || "");
  return /over concurrency limit/i.test(text) || /\((5\d\d)\)/.test(text);
}

/** Next retry time after `attempts` placed calls went unanswered, or null when out of attempts. */
export function nextRetryAt(attempts, now = new Date()) {
  if (attempts >= MAX_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MIN[attempts - 1] ?? RETRY_DELAYS_MIN.at(-1);
  return withinRetryHours(new Date(minutesFrom(now, delay))).toISOString();
}

/**
 * Flip one row pending → calling. The status check makes this exclusive, so a
 * row is never dialled twice even if the webhook and the cron race.
 * Fresh rows (next_retry_at null) and due retries are claimed separately so a
 * re-delivered webhook can't dial a retry early.
 */
async function claimRow(supabase, row, { retry = false, at }) {
  let query = supabase
    .from(callbackTable())
    .update({ status: "calling", last_attempt_at: at.toISOString() })
    .eq("id", row.id)
    .eq("status", "pending");
  query = retry ? query.lte("next_retry_at", at.toISOString()) : query.is("next_retry_at", null);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(`Callback claim failed: ${error.message}`);
  return data;
}

async function updateRow(supabase, id, patch) {
  const { error } = await supabase.from(callbackTable()).update(patch).eq("id", id);
  if (error) throw new Error(`Callback update failed: ${error.message}`);
}

/** Place the Vapi call for a claimed row and record the result on it. */
export async function dialClaimedRow(
  supabase,
  row,
  { config, dial = startLeadCall, now = () => new Date(), inlineRetries = 0, wait = sleep } = {}
) {
  const phone = normalizeCallbackPhone(row.phone_e164 || row.phone);
  if (!phone) {
    await updateRow(supabase, row.id, { status: "failed", ended_reason: "invalid-phone" });
    return { ok: false, reason: "invalid-phone" };
  }

  const { assistantId, phoneNumberId } = config || getEgmDialConfig();
  const attempt = Number(row.attempts || 0) + 1;
  const request = {
    name: row.name,
    phone,
    assistantId,
    phoneNumberId,
    variableValues: {
      vehicle: String(row.vehicle || "").trim() || "one of our cars",
      dealershipName: process.env.EGM_DEALERSHIP_NAME || "EGM Trading",
      // Echoed back on call.assistantOverrides in every Vapi webhook.
      callSource: CALL_SOURCE,
      callbackRequestId: row.id,
    },
    metadata: { source: CALL_SOURCE, callbackRequestId: row.id, attempt },
  };

  let result;
  for (let tries = 0; ; tries += 1) {
    try {
      result = await dial(request);
      break;
    } catch (error) {
      if (isTransientDialError(error.message) && tries < inlineRetries) {
        await wait(INLINE_DIAL_DELAY_MS);
        continue;
      }
      return recordDialError(supabase, row, error, now());
    }
  }

  const placedAt = now().toISOString();
  await updateRow(supabase, row.id, {
    // call_placed_at is the first attempt only — it is the 60s metric.
    ...(row.call_placed_at ? {} : { call_placed_at: placedAt }),
    last_attempt_at: placedAt,
    call_ended_at: null,
    vapi_call_id: result.callId,
    attempts: attempt,
    next_retry_at: null,
  });
  console.log(
    `[callbacks/egm] dialled request=${row.id} phone=${maskPhone(phone)} attempt=${attempt} callId=${result.callId}`
  );
  return { ok: true, callId: result.callId, attempt };
}

async function recordDialError(supabase, row, error, at) {
  // next_retry_at keeps the time this attempt first fell due, so the
  // give-up window is measured from then, not from each busy retry.
  const dueAt = row.next_retry_at || row.requested_at || at.toISOString();
  const waitedMin = (at - new Date(dueAt)) / 60_000;
  if (isTransientDialError(error.message) && waitedMin < TRANSIENT_GIVE_UP_MIN) {
    await updateRow(supabase, row.id, {
      status: "pending",
      next_retry_at: row.next_retry_at || at.toISOString(),
      ended_reason: "dial-busy",
    });
    console.warn(`[callbacks/egm] Vapi busy request=${row.id}, cron will retry`);
    return { ok: false, reason: "transient", retry: true };
  }
  await updateRow(supabase, row.id, {
    status: "failed",
    attempts: Number(row.attempts || 0) + 1,
    next_retry_at: null,
    ended_reason: `dial-error: ${String(error.message).slice(0, 200)}`,
  });
  console.error(`[callbacks/egm] dial failed request=${row.id}:`, error.message);
  return { ok: false, reason: "dial-error" };
}

/** Entry point for the Supabase INSERT webhook. */
export async function handleNewCallbackRequest(supabase, record, options = {}) {
  if (!record?.id) return { ok: false, reason: "missing-record" };
  const config = options.config || getEgmDialConfig();
  const at = (options.now || (() => new Date()))();
  const claimed = await claimRow(supabase, record, { at });
  if (!claimed) return { ok: true, skipped: true, reason: "already-claimed" };
  return dialClaimedRow(supabase, claimed, {
    inlineRetries: INLINE_DIAL_RETRIES,
    ...options,
    config,
  });
}

/**
 * Is this Vapi webhook for an EGM callback? Matched on the tag we put in
 * variableValues, or on the EGM assistant id. Returns the row id hint, or null.
 */
export function egmCallbackRef(payload) {
  const message = payload?.message ?? payload ?? {};
  const call = message.call ?? payload?.call ?? {};
  const vars = call.assistantOverrides?.variableValues || {};
  const metadata = call.metadata || message.metadata || {};
  const assistantId = String(process.env.EGM_VAPI_ASSISTANT_ID || "").trim();
  const ours =
    vars.callSource === CALL_SOURCE ||
    metadata.source === CALL_SOURCE ||
    Boolean(assistantId && call.assistantId === assistantId);
  if (!ours) return null;
  return { callbackRequestId: vars.callbackRequestId || metadata.callbackRequestId || null };
}

async function findRowForCall(supabase, callId, callbackRequestId) {
  const columns = "id, attempts, vapi_call_id, status, next_retry_at, call_ended_at";
  if (callId) {
    const { data, error } = await supabase
      .from(callbackTable())
      .select(columns)
      .eq("vapi_call_id", callId)
      .maybeSingle();
    if (error) throw new Error(`Callback lookup failed: ${error.message}`);
    if (data) return data;
  }
  if (!callbackRequestId) return null;
  const { data, error } = await supabase
    .from(callbackTable())
    .select(columns)
    .eq("id", callbackRequestId)
    .maybeSingle();
  if (error) throw new Error(`Callback lookup failed: ${error.message}`);
  return data;
}

/**
 * Called from the Vapi webhook for every end event of an EGM call. Vapi sends
 * both status-update (ended) and end-of-call-report, in either order, so this
 * is idempotent: fields are only filled, never blanked, and a `called` row is
 * never sent back to retry.
 */
export async function handleCallbackCallEnded(
  supabase,
  details,
  { callbackRequestId = null, now = () => new Date() } = {}
) {
  const row = await findRowForCall(supabase, details.callId, callbackRequestId);
  if (!row) return { processed: false, kind: CALL_SOURCE, reason: "callback-not-found" };
  // A late report for an earlier attempt must not overwrite the current one.
  if (row.vapi_call_id && row.vapi_call_id !== details.callId) {
    return { processed: false, kind: CALL_SOURCE, reason: "stale-call" };
  }

  const at = now();
  const patch = {};
  if (!row.call_ended_at) patch.call_ended_at = details.endedAt || at.toISOString();
  if (details.endedReason) patch.ended_reason = details.endedReason;
  if (details.summary) patch.summary = details.summary;
  if (details.structuredData) patch.outcome = details.structuredData;

  const retry = shouldRetryCall(details);
  if (row.status === "called") {
    // Already settled; only fill in summary/outcome.
  } else if (!retry) {
    Object.assign(patch, { status: "called", next_retry_at: null });
  } else if (row.status === "pending" && row.next_retry_at) {
    // Retry already scheduled by the other end event.
  } else {
    const retryAt = nextRetryAt(Number(row.attempts || 1), at);
    Object.assign(patch, retryAt
      ? { status: "pending", next_retry_at: retryAt }
      : { status: "failed", next_retry_at: null });
  }

  await updateRow(supabase, row.id, patch);
  return {
    processed: true,
    kind: CALL_SOURCE,
    callbackRequestId: row.id,
    status: patch.status || row.status,
  };
}

/**
 * Retry cron: dial due retries, dial rows the webhook never delivered, and
 * fail calls that never reported back.
 */
export async function processDueCallbacks(supabase, { limit = 20, ...options } = {}) {
  const config = options.config || getEgmDialConfig();
  const at = (options.now || (() => new Date()))();
  const dialOptions = { ...options, config };
  const summary = { retried: 0, missed: 0, missedFailed: 0, skipped: 0, stale: 0 };
  const table = () => supabase.from(callbackTable());

  const { data: due, error } = await table()
    .select("*")
    .eq("status", "pending")
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", at.toISOString())
    .order("next_retry_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Due callbacks lookup failed: ${error.message}`);

  for (const row of due || []) {
    const claimed = await claimRow(supabase, row, { retry: true, at });
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }
    await dialClaimedRow(supabase, claimed, dialOptions);
    summary.retried += 1;
  }

  // Webhook never arrived (AgentZero down, delivery failed). Too old to call
  // out of the blue → failed, so the team follows up by hand.
  const { data: tooOld, error: tooOldError } = await table()
    .update({ status: "failed", ended_reason: "not-dialled-in-time" })
    .eq("status", "pending")
    .is("next_retry_at", null)
    .lt("requested_at", minutesFrom(at, -MISSED_WEBHOOK_MIN.giveUp))
    .select("id");
  if (tooOldError) throw new Error(`Missed callbacks update failed: ${tooOldError.message}`);
  summary.missedFailed = tooOld?.length || 0;

  const { data: missed, error: missedError } = await table()
    .select("*")
    .eq("status", "pending")
    .is("next_retry_at", null)
    .lte("requested_at", minutesFrom(at, -MISSED_WEBHOOK_MIN.after))
    .order("requested_at", { ascending: true })
    .limit(limit);
  if (missedError) throw new Error(`Missed callbacks lookup failed: ${missedError.message}`);

  for (const row of missed || []) {
    const claimed = await claimRow(supabase, row, { at });
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }
    await dialClaimedRow(supabase, claimed, dialOptions);
    summary.missed += 1;
  }

  const { data: stale, error: staleError } = await table()
    .update({ status: "failed", ended_reason: "no-end-of-call-report" })
    .eq("status", "calling")
    .lt("last_attempt_at", minutesFrom(at, -STALE_CALL_MIN))
    .select("id");
  if (staleError) throw new Error(`Stale callbacks update failed: ${staleError.message}`);
  summary.stale = stale?.length || 0;

  return summary;
}

import {
  getDubaiParts,
  isWithinBusinessHoursForZone,
  nextWindowStartForZone,
} from "./business-hours.js";
import { buildPropertyInterest, normalizePhone } from "../leads/normalize.js";
import { getLeadTimezone } from "../leads/phone-timezone.js";
import { startLeadCall } from "../vapi/dial.js";

/**
 * Hard max batch dials per tenant per Asia/Dubai day. Not overridable.
 * Shared across cold-batch (call_queue worker) AND Jarvis batch-callback
 * worker — both read/increment via batchDialsForDay + BATCH_QUEUE_SOURCES.
 */
export const DAILY_BATCH_CAP = 200;
export const BATCH_SPACING_SECONDS = 60;
/** No batch dials at/after this hour Asia/Dubai — overflow goes to next day 6pm. */
export const BATCH_CUTOFF_HOUR_DUBAI = 22;
/** Resume hour Asia/Dubai when deferred past cutoff or daily cap. */
export const BATCH_RESUME_HOUR_DUBAI = 18;

/** Sources that count toward DAILY_BATCH_CAP (one combined ceiling). */
export const BATCH_QUEUE_SOURCES = [
  "copilot-cold-batch",
  "copilot-scheduled-batch",
  "pixxi-batch",
  "pixxi-queue",
  "jarvis-batch-callback",
];

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

function dubaiLocalToUtc({ year, month, day, hour, minute = 0 }) {
  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0) - DUBAI_OFFSET_MS);
}

export function dubaiDayBounds(date = new Date()) {
  const dubai = new Date(date.getTime() + DUBAI_OFFSET_MS);
  const start = new Date(
    Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(), dubai.getUTCDate()) -
      DUBAI_OFFSET_MS
  );
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function isAfterDubaiBatchCutoff(date = new Date()) {
  return getDubaiParts(date).hour >= BATCH_CUTOFF_HOUR_DUBAI;
}

/** Next calendar day's 6:00pm Asia/Dubai after `date`. */
export function nextDubaiSixPm(date = new Date()) {
  const { year, month, day } = getDubaiParts(date);
  return dubaiLocalToUtc({
    year,
    month,
    day: day + 1,
    hour: BATCH_RESUME_HOUR_DUBAI,
  });
}

/**
 * If now is at/after 10pm UAE, first dial is next day 6pm; otherwise keep as-is.
 * Used for cold starts, schedule snaps, and queue deferrals.
 */
export function resolveBatchDialStart(date = new Date()) {
  const parts = getDubaiParts(date);
  if (parts.hour >= BATCH_CUTOFF_HOUR_DUBAI) {
    return dubaiLocalToUtc({
      year: parts.year,
      month: parts.month,
      day: parts.day + 1,
      hour: BATCH_RESUME_HOUR_DUBAI,
    });
  }
  return new Date(date);
}

/** @deprecated use nextDubaiSixPm — kept for any older imports */
export function nextDubaiMidnight(date = new Date()) {
  return nextDubaiSixPm(date);
}

export function isBatchQueueSource(source) {
  return BATCH_QUEUE_SOURCES.includes(String(source || ""));
}

/** Actual batch dials placed that Dubai day (calls table). */
export async function batchDialsForDay(supabase, tenantId, date = new Date()) {
  const { start, end } = dubaiDayBounds(date);
  const { count, error } = await supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("source", BATCH_QUEUE_SOURCES)
    .gte("created_at", start)
    .lt("created_at", end);
  if (error) throw new Error(`Daily dial count query failed: ${error.message}`);
  return count || 0;
}

/** Pending batch queue rows still waiting to dial that Dubai day. */
export async function batchPendingForDay(supabase, tenantId, date = new Date()) {
  const { start, end } = dubaiDayBounds(date);
  const { count, error } = await supabase
    .from("call_queue")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("source", BATCH_QUEUE_SOURCES)
    .eq("processed", false)
    .gte("scheduled_for", start)
    .lt("scheduled_for", end);
  if (error) throw new Error(`Daily pending queue query failed: ${error.message}`);
  return count || 0;
}

/**
 * Slots already taken for a Dubai day = dials already placed + still pending.
 * Cancelled/failed queue rows do not count.
 */
export async function batchUsageForDay(supabase, tenantId, date = new Date()) {
  const [dials, pending] = await Promise.all([
    batchDialsForDay(supabase, tenantId, date),
    batchPendingForDay(supabase, tenantId, date),
  ]);
  return dials + pending;
}

export async function remainingDailyBatchCap(supabase, tenantId, date = new Date()) {
  const used = await batchUsageForDay(supabase, tenantId, date);
  return Math.max(0, DAILY_BATCH_CAP - used);
}

export function assertOutboundActive(tenant) {
  if (!tenant) throw new Error("Tenant not found");
  if (tenant.outbound_paused) {
    throw new Error("Outbound calling is paused for this tenant");
  }
}

export async function getOutboundTenant(supabase, tenantId) {
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, name, slug, outbound_paused, vapi_assistant_id, vapi_assistant_id_meta, vapi_assistant_id_jarvis, vapi_phone_number_id"
    )
    .eq("id", tenantId)
    .single();

  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  return data;
}

/**
 * Space calls at BATCH_SPACING_SECONDS from startAt.
 * Slots at/after 10pm Asia/Dubai roll to the next day at 6pm and continue.
 */
export function buildScheduledTimes(count, startAt) {
  const times = [];
  let cursor = resolveBatchDialStart(startAt);
  if (Number.isNaN(cursor.getTime())) throw new Error("Invalid schedule time");

  for (let index = 0; index < count; index += 1) {
    if (isAfterDubaiBatchCutoff(cursor)) {
      cursor = nextDubaiSixPm(cursor);
    }
    times.push(cursor.toISOString());
    cursor = new Date(cursor.getTime() + BATCH_SPACING_SECONDS * 1000);
  }
  return times;
}

function dubaiDayKey(date) {
  const { year, month, day } = getDubaiParts(date);
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build up to `count` slots respecting per-day hard cap (200) and 10pm→6pm rule.
 * @param {{ singleDay?: boolean }} [options] If singleDay, stop instead of spilling
 *   into later Dubai days (used by schedule_batch day chunks).
 */
export async function buildCappedBatchSchedule(
  supabase,
  tenantId,
  count,
  startAt,
  { singleDay = false } = {}
) {
  const requested = Math.max(0, Number(count) || 0);
  const times = [];
  const plannedByDay = new Map();
  let cursor = resolveBatchDialStart(startAt);
  if (Number.isNaN(cursor.getTime())) throw new Error("Invalid schedule time");
  const startDayKey = dubaiDayKey(cursor);

  // Safety: don't walk more than ~2 weeks of days looking for slots.
  let guard = 0;
  while (times.length < requested && guard < requested + 14 * DAILY_BATCH_CAP) {
    guard += 1;
    if (isAfterDubaiBatchCutoff(cursor)) {
      if (singleDay) break;
      cursor = nextDubaiSixPm(cursor);
      continue;
    }

    const dayKey = dubaiDayKey(cursor);
    if (singleDay && dayKey !== startDayKey) break;

    let planned = plannedByDay.get(dayKey);
    if (planned == null) {
      const remaining = await remainingDailyBatchCap(supabase, tenantId, cursor);
      planned = { remaining };
      plannedByDay.set(dayKey, planned);
    }

    if (planned.remaining < 1) {
      if (singleDay) break;
      cursor = nextDubaiSixPm(cursor);
      continue;
    }

    times.push(cursor.toISOString());
    planned.remaining -= 1;
    cursor = new Date(cursor.getTime() + BATCH_SPACING_SECONDS * 1000);
  }

  return { times, cappedTo: times.length, requested };
}

export async function queueLeadCalls({
  supabase,
  tenantId,
  leadIds,
  startAt,
  scheduledTimes: explicitTimes,
  source,
  requestedBy,
}) {
  if (!leadIds.length) return [];
  const scheduledTimes =
    explicitTimes && explicitTimes.length >= leadIds.length
      ? explicitTimes
      : buildScheduledTimes(leadIds.length, startAt);
  const rows = leadIds.map((leadId, index) => ({
    tenant_id: tenantId,
    lead_id: leadId,
    scheduled_for: scheduledTimes[index],
    processed: false,
    source,
    requested_by: requestedBy || null,
  }));

  const { data, error } = await supabase.from("call_queue").insert(rows).select("id, lead_id, scheduled_for");
  if (error) throw new Error(`Queue insert failed: ${error.message}`);
  return data || [];
}

/** Business-hours check in the LEAD's local timezone (from phone country code). */
export function isLeadWithinBusinessHours(phone, date = new Date()) {
  return isWithinBusinessHoursForZone(getLeadTimezone(phone), date);
}

/** Next local business-window start (UTC) for the LEAD's timezone. */
export function nextLeadWindowStart(phone, date = new Date()) {
  return nextWindowStartForZone(getLeadTimezone(phone), date);
}

export async function dialLeadNow({
  supabase,
  tenant,
  lead,
  fields = {},
  source,
  jarvisLead = false,
}) {
  assertOutboundActive(tenant);

  const leadName = String(lead.push_name || fields.name || "").trim() || "there";
  const leadSource = lead.source || fields.client_source || "one of the property portals";
  const propertyInterest = buildPropertyInterest(fields);
  const phone = normalizePhone(fields.phone || lead.wa_id);
  if (!phone) throw new Error("Lead has no valid phone number");

  // Jarvis personal dials must NEVER fall back to Pixxi/Allan (vapi_assistant_id).
  let assistantId = tenant.vapi_assistant_id;
  if (jarvisLead) {
    if (!tenant.vapi_assistant_id_jarvis) {
      throw new Error(
        "Missing tenants.vapi_assistant_id_jarvis — refuse to dial with the cold-call assistant"
      );
    }
    assistantId = tenant.vapi_assistant_id_jarvis;
  }
  if (!assistantId) {
    throw new Error("Missing Vapi assistant id for this tenant");
  }

  const result = await startLeadCall({
    name: leadName,
    phone,
    assistantId,
    phoneNumberId: tenant.vapi_phone_number_id,
    variableValues: {
      leadName,
      leadSource,
      propertyInterest,
      campaignTopic: fields.campaignTopic || "",
      formWhen: fields.formWhen || "",
      ownsProperty: fields.ownsProperty || lead.owns_property || "",
    },
    metadata: {
      tenantId: tenant.id,
      leadId: jarvisLead ? null : lead.id,
      jarvisLeadId: jarvisLead ? lead.id : null,
      pixxiLeadId: lead.pixxi_lead_id,
      source,
    },
  });

  const callRow = {
    tenant_id: tenant.id,
    vapi_call_id: result.callId,
    direction: "outbound",
    status: "initiated",
    source,
    raw: result.raw,
  };
  if (jarvisLead) {
    callRow.lead_id = null;
    callRow.jarvis_lead_id = lead.id;
  } else {
    callRow.lead_id = lead.id;
  }

  const { error } = await supabase.from("calls").insert(callRow);
  if (error) throw new Error(`Call insert failed: ${error.message}`);

  return { callId: result.callId, status: result.status };
}

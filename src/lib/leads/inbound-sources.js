import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getLeadTimezone } from "./phone-timezone.js";
import { isWithinZoneWindow, nextZoneWindowStart } from "../calls/business-hours.js";
import { shouldRetryCall } from "../callbacks/egm.js";

/**
 * Inbound lead sources (GHL forms etc.).
 *
 * POST /api/inbound/[sourceId] upserts the lead and sets call_status=waiting
 * with next_call_at. scripts/process-batch-callbacks.mjs claims due leads
 * (waiting → calling) and dials; the Vapi webhook sets the outcome:
 * done | waiting (retry) | no_answer. Relative imports: the cron imports this.
 */

/** calls.source for dials placed from an inbound source. */
export const INBOUND_CALL_SOURCE = "ghl-form";
/** Same phone queued/called within this window is not queued again. */
export const INBOUND_DEDUPE_MS = 10 * 60 * 1000;
/** A lead stuck in 'calling' this long (no webhook) is treated as no answer. */
export const INBOUND_STUCK_CALLING_MS = 30 * 60 * 1000;

// Bare national numbers (no +) are tried against these in order.
// AE first so existing UAE 05x numbers keep working; GB for Pivot2Tech.
const DEFAULT_PHONE_COUNTRIES = ["AE", "GB"];

const FALLBACK_KEYS = {
  first_name: ["first_name", "firstName"],
  last_name: ["last_name", "lastName"],
  full_name: ["full_name", "fullName"],
  name: ["name"],
  phone: ["phone", "phone_number", "phoneNumber", "mobile"],
  email: ["email"],
  external_id: ["contact_id", "contactId", "id"],
};

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

/**
 * Apply inbound_sources.field_map ({ incomingKey: leadField }) then common
 * fallback keys. GHL workflow webhooks nest custom fields under customData,
 * so those keys are flattened in. Everything unmapped is returned in `extra`.
 */
export function mapInboundPayload(body = {}, fieldMap = {}) {
  const flat = { ...body };
  if (body.customData && typeof body.customData === "object") {
    for (const [key, value] of Object.entries(body.customData)) {
      if (!(key in flat)) flat[key] = value;
    }
    delete flat.customData;
  }

  const mapped = {};
  const consumed = new Set();
  for (const [incoming, field] of Object.entries(fieldMap || {})) {
    if (present(flat[incoming]) && !present(mapped[field])) {
      mapped[field] = flat[incoming];
      consumed.add(incoming);
    }
  }
  for (const [field, keys] of Object.entries(FALLBACK_KEYS)) {
    if (present(mapped[field])) continue;
    const key = keys.find((k) => present(flat[k]));
    if (key) {
      mapped[field] = flat[key];
      consumed.add(key);
    }
  }

  const joined = [mapped.first_name, mapped.last_name]
    .filter(present)
    .map((v) => String(v).trim())
    .join(" ");
  const name = String(mapped.full_name || mapped.name || joined || "").trim() || null;

  const extra = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!consumed.has(key) && present(value)) extra[key] = value;
  }
  // field_map targets that aren't core lead fields are kept under their mapped name.
  for (const [field, value] of Object.entries(mapped)) {
    if (!(field in FALLBACK_KEYS)) extra[field] = value;
  }

  return {
    name,
    phone: present(mapped.phone) ? String(mapped.phone).trim() : null,
    email: present(mapped.email) ? String(mapped.email).trim() : null,
    externalId: present(mapped.external_id) ? String(mapped.external_id).trim() : null,
    extra,
  };
}

/** Strict E.164 via libphonenumber-js, or null if not a valid number. */
export function toE164(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const candidates = text.startsWith("+")
    ? [[text]]
    : text.startsWith("00")
      ? [[`+${text.slice(2)}`]]
      : [
          ...DEFAULT_PHONE_COUNTRIES.map((country) => [text, country]),
          [`+${text.replace(/\D/g, "")}`],
        ];
  for (const args of candidates) {
    const parsed = parsePhoneNumberFromString(...args);
    if (parsed?.isValid()) return parsed.number;
  }
  return null;
}

function windowFor(source) {
  return {
    start: source?.call_window_start || "10:00",
    end: source?.call_window_end || "19:00",
  };
}

/** First dial: now + call_delay_seconds if inside the lead-local window, else next window start. */
export function scheduleFirstCall(source, phoneE164, now = new Date()) {
  const tz = getLeadTimezone(phoneE164);
  const { start, end } = windowFor(source);
  if (isWithinZoneWindow(tz, start, end, now)) {
    const delayMs = Math.max(0, Number(source?.call_delay_seconds ?? 60)) * 1000;
    return new Date(now.getTime() + delayMs);
  }
  return nextZoneWindowStart(tz, start, end, now);
}

/** Retry: now + retry_gap_minutes, pushed into the next lead-local window if outside. */
export function scheduleRetry(source, phoneE164, now = new Date()) {
  const tz = getLeadTimezone(phoneE164);
  const { start, end } = windowFor(source);
  const gapMs = Math.max(1, Number(source?.retry_gap_minutes ?? 180)) * 60 * 1000;
  return nextZoneWindowStart(tz, start, end, new Date(now.getTime() + gapMs));
}

/** Connected = not a no-answer/busy/voicemail/failed end and not classified as such. */
export function inboundCallConnected({ endedReason, structuredData, qualification } = {}) {
  if (shouldRetryCall({ endedReason, structuredData })) return false;
  return !["no_answer", "voicemail"].includes(qualification?.outcome);
}

/**
 * Move an inbound lead out of 'calling'. Guarded on call_status='calling' so a
 * late/duplicate webhook can't clobber a newer state.
 */
export async function applyInboundCallOutcome(
  supabase,
  lead,
  { connected, optedOut = false },
  now = new Date()
) {
  if (!lead?.inbound_source_id || lead.call_status !== "calling") return null;

  const { data: source, error: sourceError } = await supabase
    .from("inbound_sources")
    .select("max_attempts, retry_gap_minutes, call_window_start, call_window_end")
    .eq("id", lead.inbound_source_id)
    .maybeSingle();
  if (sourceError) throw new Error(`Inbound source lookup failed: ${sourceError.message}`);

  let patch;
  if (connected || optedOut) {
    patch = { call_status: "done", next_call_at: null };
  } else if ((lead.call_attempts || 0) < (source?.max_attempts ?? 3)) {
    const phone = `+${String(lead.wa_id || "").replace(/\D/g, "")}`;
    patch = {
      call_status: "waiting",
      next_call_at: scheduleRetry(source, phone, now).toISOString(),
    };
  } else {
    patch = { call_status: "no_answer", next_call_at: null };
  }

  const { error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", lead.id)
    .eq("call_status", "calling");
  if (error) throw new Error(`Inbound outcome update failed: ${error.message}`);
  return patch;
}

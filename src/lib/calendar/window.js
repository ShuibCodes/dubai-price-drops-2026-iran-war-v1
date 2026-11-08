import {
  DEFAULT_APPOINTMENT_BUFFER_MINUTES,
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  DEFAULT_CALENDAR_TIMEZONE,
  VIEWING_WINDOW,
} from "./schema.js";

const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseOffsetMinutes(offset) {
  const raw = String(offset || "Z");
  if (raw === "Z" || raw === "z") return 0;
  const match = raw.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatOffset(offsetMinutes) {
  if (offsetMinutes === 0) return "Z";
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Add minutes to an ISO timestamp while keeping the original offset.
 * Avoids turning +04:00 wall times into UTC Z in the spoken tool result.
 */
export function addMinutesIso(startDateTime, minutes) {
  const start = String(startDateTime || "");
  const base = Date.parse(start);
  if (!Number.isFinite(base)) {
    throw new Error("Invalid startDateTime");
  }
  const next = base + Number(minutes) * 60 * 1000;
  const offsetMatch = start.match(/([zZ]|[+-]\d{2}:?\d{2})$/);
  const offsetToken = offsetMatch ? offsetMatch[1] : "Z";
  if (offsetToken === "Z" || offsetToken === "z") {
    return new Date(next).toISOString();
  }
  const offsetMinutes = parseOffsetMinutes(offsetToken);
  const local = new Date(next + offsetMinutes * 60 * 1000);
  return [
    local.getUTCFullYear(),
    "-",
    pad(local.getUTCMonth() + 1),
    "-",
    pad(local.getUTCDate()),
    "T",
    pad(local.getUTCHours()),
    ":",
    pad(local.getUTCMinutes()),
    ":",
    pad(local.getUTCSeconds()),
    formatOffset(offsetMinutes),
  ].join("");
}

export function expandBusyWithBuffer(
  busy = [],
  bufferMinutes = DEFAULT_APPOINTMENT_BUFFER_MINUTES
) {
  const bufferMs = Math.max(0, Number(bufferMinutes) || 0) * 60 * 1000;
  return busy.map((slot) => {
    const start = Date.parse(slot.start);
    const end = Date.parse(slot.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return slot;
    return {
      start: new Date(start - bufferMs).toISOString(),
      end: new Date(end + bufferMs).toISOString(),
    };
  });
}

export function slotOverlapsBusy(startDateTime, endDateTime, busy = []) {
  const start = Date.parse(startDateTime);
  const end = Date.parse(endDateTime);
  return busy.some((slot) => {
    const busyStart = Date.parse(slot.start);
    const busyEnd = Date.parse(slot.end);
    return (
      Number.isFinite(busyStart) &&
      Number.isFinite(busyEnd) &&
      busyStart < end &&
      busyEnd > start
    );
  });
}

export function isWithinViewingWindow(iso, timeZone) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return false;
  const tz =
    String(timeZone || DEFAULT_CALENDAR_TIMEZONE).trim() ||
    DEFAULT_CALENDAR_TIMEZONE;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
    const weekday = parts.find((part) => part.type === "weekday")?.value;
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const day = WEEKDAY_INDEX[weekday];
    if (day == null || !Number.isFinite(hour)) return false;
    if (!VIEWING_WINDOW.days.includes(day)) return false;
    return hour >= VIEWING_WINDOW.startHour && hour < VIEWING_WINDOW.endHour;
  } catch {
    return false;
  }
}

export function viewingWindowAllows(window) {
  if (!window?.startDateTime || !window?.endDateTime) return false;
  return (
    isWithinViewingWindow(window.startDateTime, window.timeZone) &&
    isWithinViewingWindow(addMinutesIso(window.endDateTime, -1), window.timeZone)
  );
}

export function resolveBookingWindow(args, connection) {
  const duration =
    Number.isFinite(args?.durationMinutes) && args.durationMinutes > 0
      ? args.durationMinutes
      : DEFAULT_APPOINTMENT_DURATION_MINUTES;
  const startDateTime = args.startDateTime;
  const endDateTime = args.endDateTime || addMinutesIso(startDateTime, duration);
  const timeZone =
    connection?.calendar_timezone ||
    args.timeZone ||
    DEFAULT_CALENDAR_TIMEZONE;
  return { startDateTime, endDateTime, timeZone, durationMinutes: duration };
}

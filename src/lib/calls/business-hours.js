const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

export function getDubaiParts(date = new Date()) {
  const dubaiMs = date.getTime() + DUBAI_OFFSET_MS;
  const dubai = new Date(dubaiMs);
  return {
    year: dubai.getUTCFullYear(),
    month: dubai.getUTCMonth(),
    day: dubai.getUTCDate(),
    hour: dubai.getUTCHours(),
    minute: dubai.getUTCMinutes(),
  };
}

function getWindowBounds() {
  const start = Number(process.env.CALLS_BUSINESS_HOURS_START ?? 9);
  const end = Number(process.env.CALLS_BUSINESS_HOURS_END ?? 20);
  return {
    start: Number.isFinite(start) ? start : 9,
    end: Number.isFinite(end) ? end : 20,
  };
}

function dubaiLocalToUtc({ year, month, day, hour, minute = 0 }) {
  const utcMs = Date.UTC(year, month, day, hour, minute, 0, 0) - DUBAI_OFFSET_MS;
  return new Date(utcMs);
}

export function isWithinBusinessHours(date = new Date()) {
  const { hour } = getDubaiParts(date);
  const { start, end } = getWindowBounds();
  return hour >= start && hour < end;
}

// International leads are gated 9:00–21:00 in THEIR local time. Asia/Dubai
// keeps the env-configured window so existing +971 behavior is unchanged.
const INTL_WINDOW = { start: 9, end: 21 };

function getWindowBoundsForZone(timeZone) {
  return timeZone === "Asia/Dubai" ? getWindowBounds() : INTL_WINDOW;
}

function getZoneParts(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month") - 1,
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** Approximate UTC offset of a zone at a moment (DST-aware enough for scheduling). */
function getZoneOffsetMs(timeZone, date = new Date()) {
  const zoned = getZoneParts(timeZone, date);
  const asUtc = Date.UTC(zoned.year, zoned.month, zoned.day, zoned.hour, zoned.minute);
  const truncated = new Date(date);
  truncated.setUTCSeconds(0, 0);
  return asUtc - truncated.getTime();
}

export function isWithinBusinessHoursForZone(timeZone, date = new Date()) {
  const { hour } = getZoneParts(timeZone, date);
  const { start, end } = getWindowBoundsForZone(timeZone);
  return hour >= start && hour < end;
}

/** Next business-window start (in UTC) for the zone, plus 5 minutes. */
export function nextWindowStartForZone(timeZone, date = new Date()) {
  const parts = getZoneParts(timeZone, date);
  const { start, end } = getWindowBoundsForZone(timeZone);

  if (parts.hour >= start && parts.hour < end) return date;

  let dayShift = 0;
  if (parts.hour >= end) dayShift = 1;

  const offset = getZoneOffsetMs(timeZone, date);
  const targetUtcMs =
    Date.UTC(parts.year, parts.month, parts.day + dayShift, start, 5) - offset;
  return new Date(targetUtcMs);
}

/** Next business-window start in UTC, plus 5 minutes (queue scheduling). */
export function nextWindowStart(date = new Date()) {
  const parts = getDubaiParts(date);
  const { start, end } = getWindowBounds();

  let targetYear = parts.year;
  let targetMonth = parts.month;
  let targetDay = parts.day;
  let targetHour = start;
  let targetMinute = 5;

  if (parts.hour < start) {
    // Before today's window — schedule today at start + 5 min
  } else if (parts.hour >= end) {
    // After today's window — schedule tomorrow at start + 5 min
    const tomorrow = dubaiLocalToUtc({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 12,
    });
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const t = getDubaiParts(tomorrow);
    targetYear = t.year;
    targetMonth = t.month;
    targetDay = t.day;
  } else {
    // Inside window — immediate (caller may dial now)
    return date;
  }

  return dubaiLocalToUtc({
    year: targetYear,
    month: targetMonth,
    day: targetDay,
    hour: targetHour,
    minute: targetMinute,
  });
}

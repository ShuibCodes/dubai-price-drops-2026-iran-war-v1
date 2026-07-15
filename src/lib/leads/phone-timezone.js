export const DEFAULT_LEAD_TIMEZONE = "Asia/Dubai";

// One IANA zone per country calling code. For multi-zone countries we pick the
// largest-population zone (US → America/New_York, Russia → Europe/Moscow,
// Kazakhstan's +7 6xx/7xx also resolves to Europe/Moscow via the shared +7
// prefix) — calls may land a few hours off local time for leads in other
// regions of those countries.
const COUNTRY_CODE_TIMEZONES = {
  971: "Asia/Dubai",
  966: "Asia/Riyadh",
  973: "Asia/Bahrain",
  974: "Asia/Qatar",
  965: "Asia/Kuwait",
  968: "Asia/Muscat",
  44: "Europe/London",
  91: "Asia/Kolkata",
  92: "Asia/Karachi",
  90: "Europe/Istanbul",
  49: "Europe/Berlin",
  33: "Europe/Paris",
  20: "Africa/Cairo",
  7: "Europe/Moscow",
  1: "America/New_York",
};

// Longest prefix first so 971 wins over 97, 91 over 9, etc.
const PREFIXES = Object.keys(COUNTRY_CODE_TIMEZONES).sort(
  (a, b) => b.length - a.length
);

const warnedPrefixes = new Set();

export function getLeadTimezone(phoneE164) {
  const digits = String(phoneE164 || "").replace(/\D/g, "");
  if (!digits) return DEFAULT_LEAD_TIMEZONE;

  for (const prefix of PREFIXES) {
    if (digits.startsWith(prefix)) return COUNTRY_CODE_TIMEZONES[prefix];
  }

  const unknown = digits.slice(0, 3);
  if (!warnedPrefixes.has(unknown)) {
    warnedPrefixes.add(unknown);
    console.warn(
      `[phone-timezone] Unknown country prefix +${unknown}… — defaulting to ${DEFAULT_LEAD_TIMEZONE}`
    );
  }
  return DEFAULT_LEAD_TIMEZONE;
}

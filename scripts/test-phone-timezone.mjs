import { getLeadTimezone, DEFAULT_LEAD_TIMEZONE } from "../src/lib/leads/phone-timezone.js";
import {
  isWithinBusinessHours,
  isWithinBusinessHoursForZone,
  nextWindowStartForZone,
} from "../src/lib/calls/business-hours.js";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed += 1;
    console.log(`  ok: ${label}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL: ${label}`);
  console.error(`    expected: ${JSON.stringify(expected)}`);
  console.error(`    actual:   ${JSON.stringify(actual)}`);
}

console.log("getLeadTimezone");
assertEqual(getLeadTimezone("+971554229317"), "Asia/Dubai", "UAE +971");
assertEqual(getLeadTimezone("+966501234567"), "Asia/Riyadh", "Saudi +966");
assertEqual(getLeadTimezone("+447911123456"), "Europe/London", "UK +44");
assertEqual(getLeadTimezone("+919812345678"), "Asia/Kolkata", "India +91");
assertEqual(getLeadTimezone("+79161234567"), "Europe/Moscow", "Russia +7");
assertEqual(getLeadTimezone("+97333123456"), "Asia/Bahrain", "Bahrain +973");
assertEqual(getLeadTimezone("+97455123456"), "Asia/Qatar", "Qatar +974");
assertEqual(getLeadTimezone("+96550123456"), "Asia/Kuwait", "Kuwait +965");
assertEqual(getLeadTimezone("+96891234567"), "Asia/Muscat", "Oman +968");
assertEqual(getLeadTimezone("+201001234567"), "Africa/Cairo", "Egypt +20");
assertEqual(getLeadTimezone("+923001234567"), "Asia/Karachi", "Pakistan +92");
assertEqual(getLeadTimezone("+12025550123"), "America/New_York", "US +1");
assertEqual(getLeadTimezone("+33612345678"), "Europe/Paris", "France +33");
assertEqual(getLeadTimezone("+4915123456789"), "Europe/Berlin", "Germany +49");
assertEqual(getLeadTimezone("+905321234567"), "Europe/Istanbul", "Turkey +90");

console.log("\ngetLeadTimezone longest-prefix precedence");
assertEqual(getLeadTimezone("971554229317"), "Asia/Dubai", "971 wins over 97/9 (no plus)");
assertEqual(getLeadTimezone("+96891234567"), "Asia/Muscat", "968 wins over 96/9");

console.log("\ngetLeadTimezone fallbacks");
assertEqual(getLeadTimezone("+35812345678"), DEFAULT_LEAD_TIMEZONE, "unknown prefix defaults to Dubai");
assertEqual(getLeadTimezone(""), DEFAULT_LEAD_TIMEZONE, "empty input defaults to Dubai");
assertEqual(getLeadTimezone(null), DEFAULT_LEAD_TIMEZONE, "null input defaults to Dubai");

console.log("\nisWithinBusinessHoursForZone — Dubai parity with legacy check");
// Asia/Dubai must behave exactly like the legacy fixed-offset Dubai check.
for (let hourUtc = 0; hourUtc < 24; hourUtc += 1) {
  const probe = new Date(Date.UTC(2026, 6, 14, hourUtc, 30));
  assertEqual(
    isWithinBusinessHoursForZone("Asia/Dubai", probe),
    isWithinBusinessHours(probe),
    `Dubai parity at ${String(hourUtc).padStart(2, "0")}:30 UTC`
  );
}

console.log("\nisWithinBusinessHoursForZone — international 9-21 local window");
// 2026-07-14 10:00 UTC = 11:00 London (in) / 06:00 New York (out) / 13:00 Moscow (in)
const midday = new Date(Date.UTC(2026, 6, 14, 10, 0));
assertEqual(isWithinBusinessHoursForZone("Europe/London", midday), true, "London 11:00 in window");
assertEqual(isWithinBusinessHoursForZone("America/New_York", midday), false, "New York 06:00 out of window");
assertEqual(isWithinBusinessHoursForZone("Europe/Moscow", midday), true, "Moscow 13:00 in window");
// 2026-07-14 19:00 UTC = 20:00 London (in, ends 21) / 23:00 Dubai (out)
const evening = new Date(Date.UTC(2026, 6, 14, 19, 0));
assertEqual(isWithinBusinessHoursForZone("Europe/London", evening), true, "London 20:00 still in window");
assertEqual(isWithinBusinessHoursForZone("Asia/Dubai", evening), false, "Dubai 23:00 out of window");

console.log("\nnextWindowStartForZone");
// Inside the window returns the same moment.
assertEqual(
  nextWindowStartForZone("Europe/London", midday).getTime(),
  midday.getTime(),
  "inside window returns input date"
);
// London 22:00 (21:00 UTC in July/BST) → next day 09:05 London = 08:05 UTC.
const lateLondon = new Date(Date.UTC(2026, 6, 14, 21, 0));
assertEqual(
  nextWindowStartForZone("Europe/London", lateLondon).toISOString(),
  "2026-07-15T08:05:00.000Z",
  "late London evening → next 09:05 local"
);
// New York 03:00 (07:00 UTC in July/EDT) → same day 09:05 local = 13:05 UTC.
const earlyNewYork = new Date(Date.UTC(2026, 6, 14, 7, 0));
assertEqual(
  nextWindowStartForZone("America/New_York", earlyNewYork).toISOString(),
  "2026-07-14T13:05:00.000Z",
  "early New York morning → same-day 09:05 local"
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

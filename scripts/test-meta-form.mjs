import {
  extractCampaignTopic,
  humanizeFormTime,
  normalizeOwnsProperty,
} from "../src/lib/leads/meta-form.js";

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

console.log("extractCampaignTopic");
assertEqual(
  extractCampaignTopic("Ellington Open House- June 2026 - Video ads", ""),
  "Ellington",
  "Ellington Open House- June 2026 - Video ads"
);
assertEqual(
  extractCampaignTopic("Open House - Dubai Hills", ""),
  "Dubai Hills",
  "Open House - Dubai Hills"
);
assertEqual(
  extractCampaignTopic("Damac Lagoons Launch | Lead form", ""),
  "Damac Lagoons",
  "Damac Lagoons Launch | Lead form"
);
assertEqual(extractCampaignTopic("", ""), "", "empty");
assertEqual(
  extractCampaignTopic("", "Open House - Dubai Hills"),
  "Dubai Hills",
  "falls back to form_name"
);

console.log("\nhumanizeFormTime");
const now = new Date("2026-07-09T12:00:00+04:00"); // noon Dubai
assertEqual(
  humanizeFormTime("2026-07-09T11:45:00+04:00", now),
  "a few minutes ago",
  "<30 min"
);
assertEqual(
  humanizeFormTime("2026-07-09T08:00:00+04:00", now),
  "earlier today",
  "same Dubai day"
);
assertEqual(
  humanizeFormTime("2026-07-08T20:00:00+04:00", now),
  "yesterday",
  "yesterday Dubai"
);
assertEqual(
  humanizeFormTime("2026-07-01T12:00:00+04:00", now),
  "recently",
  "older"
);
assertEqual(humanizeFormTime("", now), "recently", "empty");
assertEqual(humanizeFormTime("not-a-date", now), "recently", "invalid");

console.log("\nnormalizeOwnsProperty");
assertEqual(normalizeOwnsProperty("Yes"), "yes", "Yes");
assertEqual(normalizeOwnsProperty("NO"), "no", "NO");
assertEqual(normalizeOwnsProperty(""), "", "empty");
assertEqual(normalizeOwnsProperty("maybe"), "", "unknown");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

import { parseBatchCallbackCommand } from "../src/lib/jarvis/batch-callback-search.js";

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

function parseWindowDays(text) {
  return parseBatchCallbackCommand(text).windowDays;
}

console.log("parseBatchCallbackCommand — windowDays");

console.log("\nbare last X (pattern 4)");
assertEqual(
  parseWindowDays("call everyone who asked about budget last week"),
  7,
  '"last week" → 7 days'
);
assertEqual(
  parseWindowDays("call everyone who mentioned off-plan last month"),
  30,
  '"last month" → 30 days'
);
assertEqual(
  parseWindowDays("call everyone inactive last year"),
  365,
  '"last year" → 365 days'
);

console.log("\nbare matches preposition form (pattern 3)");
assertEqual(
  parseWindowDays("call everyone who asked about budget last week"),
  parseWindowDays("call everyone who asked about budget in the last week"),
  '"last week" same windowDays as "in the last week"'
);
assertEqual(
  parseWindowDays("call everyone who mentioned off-plan last month"),
  parseWindowDays("call everyone who mentioned off-plan in the last month"),
  '"last month" same windowDays as "in the last month"'
);

console.log("\nin the last X (pattern 3 — unchanged)");
assertEqual(
  parseWindowDays("call everyone who asked about budget in the last week"),
  7,
  '"in the last week" → 7 days'
);
assertEqual(
  parseWindowDays("call everyone who mentioned off-plan in the last month"),
  30,
  '"in the last month" → 30 days'
);
assertEqual(
  parseWindowDays("call everyone inactive in the last year"),
  365,
  '"in the last year" → 365 days'
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

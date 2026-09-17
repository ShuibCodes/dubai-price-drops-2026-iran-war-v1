import { formatBatchCallbackPreview } from "../src/lib/jarvis/batch-callback.js";

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

function assertIncludes(haystack, needle, label) {
  if (String(haystack).includes(needle)) {
    passed += 1;
    console.log(`  ok: ${label}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL: ${label}`);
  console.error(`    missing: ${JSON.stringify(needle)}`);
  console.error(`    in: ${JSON.stringify(haystack).slice(0, 400)}…`);
}

function assertNotIncludes(haystack, needle, label) {
  if (!String(haystack).includes(needle)) {
    passed += 1;
    console.log(`  ok: ${label}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL: ${label}`);
  console.error(`    should not include: ${JSON.stringify(needle)}`);
}

function assertMatch(haystack, pattern, label) {
  if (pattern.test(String(haystack))) {
    passed += 1;
    console.log(`  ok: ${label}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL: ${label}`);
  console.error(`    pattern: ${pattern}`);
  console.error(`    actual: ${JSON.stringify(haystack).slice(0, 400)}…`);
}

function makeMatch(index, overrides = {}) {
  return {
    jarvis_lead_id: `lead-${index}`,
    display_name: overrides.display_name ?? `Lead ${index}`,
    phone_e164: overrides.phone_e164 ?? `+97155000000${index}`,
    match_reason: overrides.match_reason ?? `match reason ${index}`,
    ...overrides,
  };
}

function makeMatches(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) =>
    makeMatch(index + 1, typeof overrides === "function" ? overrides(index) : overrides)
  );
}

console.log("formatBatchCallbackPreview — normal case (4 matches)");
{
  const preview = formatBatchCallbackPreview({
    intent: "mentioned a budget",
    windowDays: 21,
    matches: [
      makeMatch(1, {
        display_name: "Tom",
        phone_e164: "+971551234567",
        match_reason: "asked about max spend",
      }),
      makeMatch(2, {
        display_name: "Sarah",
        phone_e164: "+971559876543",
        match_reason: "budget around 2M AED",
      }),
      makeMatch(3, {
        display_name: "Ahmed",
        phone_e164: "+971554445566",
        match_reason: "what is my price range?",
      }),
      makeMatch(4, {
        display_name: "Lina",
        phone_e164: "+971553334444",
        match_reason: "can go up to 1.8M",
      }),
    ],
  });

  assertIncludes(
    preview,
    'Found 4 contacts in the last 21 days matching "mentioned a budget":',
    "header with count, window, and intent"
  );
  assertIncludes(
    preview,
    "1. Tom (+971551234567) — asked about max spend",
    "line 1 format"
  );
  assertIncludes(
    preview,
    "2. Sarah (+971559876543) — budget around 2M AED",
    "line 2 format"
  );
  assertIncludes(
    preview,
    "3. Ahmed (+971554445566) — what is my price range?",
    "line 3 format"
  );
  assertIncludes(
    preview,
    "4. Lina (+971553334444) — can go up to 1.8M",
    "line 4 format"
  );
  assertEqual(
    preview.trimEnd().split("\n").at(-1),
    "Reply yes to queue 4 callback calls, or no to cancel.",
    "footer"
  );
}

console.log("\nformatBatchCallbackPreview — zero matches");
{
  const preview = formatBatchCallbackPreview({
    intent: "asked about off-plan",
    windowDays: 14,
    matches: [],
  });

  assertEqual(
    preview,
    'No contacts matched "asked about off-plan" in the last 14 days. Try a different search or widen the window.',
    "no-match message"
  );
  assertNotIncludes(preview, "1.", "no numbered list");
  assertNotIncludes(preview, "Reply yes", "no confirm footer");
}

console.log("\nformatBatchCallbackPreview — exactly 12 matches (line cap boundary)");
{
  const preview = formatBatchCallbackPreview({
    intent: "mentioned renting",
    windowDays: 21,
    matches: makeMatches(12),
  });

  assertIncludes(preview, "Found 12 contacts", "header count");
  assertMatch(preview, /^12\. Lead 12 \(\+9715500000012\)/m, "shows line 12");
  assertNotIncludes(preview, "(+ ", "no overflow line at cap");
  assertEqual(
    preview.trimEnd().split("\n").at(-1),
    "Reply yes to queue 12 callback calls, or no to cancel.",
    "footer uses full count"
  );
}

console.log("\nformatBatchCallbackPreview — 13 matches (+ N more)");
{
  const preview = formatBatchCallbackPreview({
    intent: "mentioned renting",
    windowDays: 21,
    matches: makeMatches(13),
  });

  assertIncludes(preview, "(+ 1 more)", "overflow count");
  assertMatch(preview, /^12\. Lead 12/m, "shows through line 12 only");
  assertNotIncludes(preview, "13. Lead 13", "line 13 not listed");
  assertEqual(
    preview.trimEnd().split("\n").at(-1),
    "Reply yes to queue 13 callback calls, or no to cancel.",
    "footer uses full match count"
  );
}

console.log("\nformatBatchCallbackPreview — near 1500-char truncation limit");
{
  const longIntent = "mentioned a budget ".repeat(12).trim();
  const longReason = "looking for something under two million dirhams with ".repeat(3).trim();
  const preview = formatBatchCallbackPreview({
    intent: longIntent,
    windowDays: 21,
    matches: makeMatches(12, {
      match_reason: longReason,
    }),
  });

  assertMatch(
    preview,
    /Reply yes to queue 12 callback calls, or no to cancel\.$/,
    "footer preserved at end"
  );
  assertIncludes(preview, "(truncated — ask to see more)", "truncation note when over limit");
  if (preview.length > 1500) {
    failed += 1;
    console.error(`  FAIL: preview length ${preview.length} exceeds 1500`);
  } else {
    passed += 1;
    console.log("  ok: preview length within 1500");
  }

  const lines = preview.split("\n").filter(Boolean);
  let trailingWhitespace = false;
  for (const line of lines) {
    if (line.startsWith("Reply yes") || line.startsWith("(truncated")) continue;
    if (/\s$/.test(line)) {
      trailingWhitespace = true;
      break;
    }
  }
  if (!trailingWhitespace) {
    passed += 1;
    console.log("  ok: lines do not end mid-word with trailing whitespace");
  } else {
    failed += 1;
    console.error("  FAIL: a content line ends with trailing whitespace");
  }
}

console.log("\nformatBatchCallbackPreview — missing/null fields");
{
  const preview = formatBatchCallbackPreview({
    intent: "anyone interested",
    matches: [
      {
        jarvis_lead_id: "x1",
        display_name: null,
        phone_e164: null,
        match_reason: null,
      },
      {
        jarvis_lead_id: "x2",
        display_name: "  ",
        phone_e164: "",
        match_reason: undefined,
      },
    ],
  });

  assertIncludes(preview, "Found 2 contacts matching", "header without crash");
  assertIncludes(preview, "1. Unknown", "missing name and phone degrade to Unknown");
  assertNotIncludes(preview, "1. Unknown (", "no empty phone parens");
  assertIncludes(preview, "2. Unknown", "blank name degrades to Unknown");
  assertEqual(
    preview.trimEnd().split("\n").at(-1),
    "Reply yes to queue 2 callback calls, or no to cancel.",
    "footer still present"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

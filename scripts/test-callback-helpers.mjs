/**
 * Regression tests for Smart Callback List helpers (Mustaf).
 * Pure functions only — no Vapi, no Claude, no database, no WhatsApp preview.
 *
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/test-callback-helpers.mjs
 *
 * The loader is required because batch-callback-search.js and lists.js use @/ imports.
 */
import {
  BATCH_CALLBACK_DEFAULT_WINDOW_DAYS,
  parseBatchCallbackCommand,
} from "../src/lib/jarvis/batch-callback-search.js";
import {
  isJarvisAffirmative,
  isJarvisNegative,
} from "../src/lib/jarvis/confirm.js";
import {
  buildJarvisNameOrFilter,
  cleanJarvisSearchName,
  jarvisNameSearchTerms,
} from "../src/lib/jarvis/name-search.js";
import { matchSavedList } from "../src/lib/console/lists.js";

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

function assertDeepEqual(actual, expected, label) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), label);
}

function parsed(text) {
  return parseBatchCallbackCommand(text);
}

console.log("parseBatchCallbackCommand — default window");
assertEqual(BATCH_CALLBACK_DEFAULT_WINDOW_DAYS, 21, "exported default is 21 days");
assertEqual(
  parsed("call everyone who mentioned a budget").windowDays,
  21,
  "no window phrase → 21 days"
);
assertEqual(
  parsed("people who asked about off-plan").windowDays,
  21,
  "intent-only command → 21 days"
);

console.log("\nparseBatchCallbackCommand — last 3 months → 90 days");
assertEqual(
  parsed("call everyone who mentioned a budget in the last 3 months").windowDays,
  90,
  "in the last 3 months → 90"
);
assertEqual(
  parsed("everyone who asked about renting last 3 months").windowDays,
  90,
  "last 3 months (no in/the) → 90"
);
assertEqual(
  parsed("people who asked about off-plan over the past 3 months").windowDays,
  90,
  "past 3 months → 90"
);

console.log("\nparseBatchCallbackCommand — last week → 7 days");
assertEqual(
  parsed("call everyone who asked about renting in the last week").windowDays,
  7,
  "in the last week → 7"
);
assertEqual(
  parsed("during the last week call everyone who mentioned a budget").windowDays,
  7,
  "during the last week → 7"
);
assertEqual(
  parsed("call everyone who mentioned a budget last 1 week").windowDays,
  7,
  "last 1 week → 7"
);
// Bare "last week" has no leading in/over/during and no digit, so the parser
// does not treat it as a window (see report after this run).
assertEqual(
  parsed("call everyone who mentioned a budget last week").windowDays,
  21,
  "bare 'last week' (no in/over/during, no digit) stays default 21"
);

console.log("\nparseBatchCallbackCommand — strips call everyone who …");
assertEqual(
  parsed("call everyone who mentioned a budget").intent,
  "mentioned a budget",
  "call everyone who → stripped"
);
assertEqual(
  parsed("please can you call everyone who asked about off-plan").intent,
  "asked about off-plan",
  "please can you call everyone who → stripped"
);
assertEqual(
  parsed("find people that mentioned a budget").intent,
  "mentioned a budget",
  "find people that → stripped"
);
assertEqual(
  parsed("show leads who asked about renting").intent,
  "asked about renting",
  "show leads who → stripped"
);
assertEqual(parsed("call everyone who mentioned a budget").raw, "call everyone who mentioned a budget", "raw is the trimmed original");

console.log("\nparseBatchCallbackCommand — window clamp 1–366");
assertEqual(parsed("last 400 days mentioned a budget").windowDays, 366, "last 400 days clamps to 366");
assertEqual(parsed("in the last 500 days").windowDays, 366, "in the last 500 days clamps to 366");
assertEqual(parsed("last 0 days mentioned a budget").windowDays, 1, "last 0 days clamps to 1");
assertEqual(parsed("last 1 day mentioned a budget").windowDays, 1, "last 1 day stays 1");

console.log("\nparseBatchCallbackCommand — empty/weak intent falls back to raw");
assertEqual(
  parsed("in the last week").intent,
  "in the last week",
  "window-only text: empty intent falls back to raw"
);
assertEqual(parsed("in the last week").windowDays, 7, "window-only 'in the last week' still yields 7 days");
assertEqual(parsed("last 3 months").intent, "last 3 months", "window-only 'last 3 months' falls back to raw");
assertEqual(parsed("").intent, "", "empty string: intent stays empty raw");
assertEqual(parsed("").windowDays, 21, "empty string: default window 21");
assertEqual(parsed("   ").intent, "", "whitespace-only: empty raw");

console.log("\nisJarvisAffirmative — exact phrases");
assertEqual(isJarvisAffirmative("yes"), true, "yes is affirmative");
assertEqual(isJarvisAffirmative("Yes"), true, "Yes (capitalized) is affirmative");
assertEqual(isJarvisAffirmative("yes!"), true, "yes! strips trailing punct");
assertEqual(isJarvisAffirmative("go ahead"), true, "go ahead is affirmative");
assertEqual(isJarvisAffirmative("  go ahead  "), true, "go ahead with padding");
assertEqual(isJarvisAffirmative("ok"), true, "ok alone is affirmative");
assertEqual(isJarvisAffirmative("okay"), true, "okay is affirmative");

console.log("\nisJarvisAffirmative — chatter must not confirm");
assertEqual(isJarvisAffirmative("ok thanks"), false, "ok thanks is NOT affirmative");
assertEqual(isJarvisAffirmative("yes please"), false, "yes please is NOT an exact phrase");
assertEqual(isJarvisAffirmative("sounds good"), false, "sounds good is chatter");
assertEqual(isJarvisAffirmative("thanks"), false, "thanks is chatter");
assertEqual(isJarvisAffirmative("what about Ahmed?"), false, "question chatter");
assertEqual(isJarvisAffirmative(""), false, "empty is not affirmative");
assertEqual(isJarvisAffirmative(null), false, "null is not affirmative");

console.log("\nisJarvisAffirmative — allowCall / allowSave");
assertEqual(isJarvisAffirmative("call him"), false, "call him without allowCall is false");
assertEqual(isJarvisAffirmative("call him", {}), false, "call him with empty options is false");
assertEqual(
  isJarvisAffirmative("call him", { allowCall: true }),
  true,
  "call him with allowCall is true"
);
assertEqual(
  isJarvisAffirmative("call him", { allowSave: true }),
  false,
  "call him with only allowSave is false"
);
assertEqual(isJarvisAffirmative("save it"), false, "save it without allowSave is false");
assertEqual(
  isJarvisAffirmative("save it", { allowSave: true }),
  true,
  "save it with allowSave is true"
);
assertEqual(
  isJarvisAffirmative("save it", { allowCall: true }),
  false,
  "save it with only allowCall is false"
);
assertEqual(isJarvisAffirmative("dial", { allowCall: true }), true, "dial with allowCall");
assertEqual(isJarvisAffirmative("add them", { allowSave: true }), true, "add them with allowSave");

console.log("\nisJarvisNegative");
assertEqual(isJarvisNegative("no"), true, "no is negative");
assertEqual(isJarvisNegative("cancel"), true, "cancel is negative");
assertEqual(isJarvisNegative("never mind"), true, "never mind is negative");
assertEqual(isJarvisNegative("no thanks"), true, "no thanks matches leading-no regex");
assertEqual(isJarvisNegative("cancel that"), true, "cancel that matches leading-cancel regex");
assertEqual(isJarvisNegative("don't"), true, "don't is negative");

console.log("\nisJarvisNegative — chatter must not cancel");
assertEqual(isJarvisNegative("ok thanks"), false, "ok thanks is not negative");
assertEqual(isJarvisNegative("thanks"), false, "thanks is not negative");
assertEqual(isJarvisNegative("not sure yet"), false, "not sure yet is not negative");
assertEqual(isJarvisNegative("maybe later"), false, "maybe later is not negative");
assertEqual(isJarvisNegative("yes"), false, "yes is not negative");
assertEqual(isJarvisNegative(""), false, "empty is not negative");

console.log("\ncleanJarvisSearchName");
assertEqual(cleanJarvisSearchName("Ahmed"), "Ahmed", "plain name unchanged");
assertEqual(cleanJarvisSearchName("*Shuayb*"), "Shuayb", "strips WhatsApp italic asterisks");
assertEqual(cleanJarvisSearchName("**Ahmed**"), "Ahmed", "strips WhatsApp bold asterisks");
assertEqual(cleanJarvisSearchName("_Sara_"), "Sara", "strips underscores");
assertEqual(cleanJarvisSearchName("Tom (buyer)"), "Tom buyer", "parentheses become spaces");
assertEqual(cleanJarvisSearchName("  Ahmed   Khan  "), "Ahmed Khan", "collapses whitespace");
assertEqual(cleanJarvisSearchName(""), "", "empty string");

console.log("\njarvisNameSearchTerms — normal names and Shuayb aliases");
assertDeepEqual(jarvisNameSearchTerms(""), [], "empty name → no terms");
assertDeepEqual(
  jarvisNameSearchTerms("Ahmed Khan"),
  ["Ahmed Khan", "ahmed"],
  "normal full name: cleaned + first token"
);
assertDeepEqual(
  jarvisNameSearchTerms("Shuayb"),
  ["Shuayb", "shuayb", "shuaib", "shoaib", "shuayib", "shuaieb"],
  "Shuayb expands aliases"
);
assertDeepEqual(
  jarvisNameSearchTerms("*Shuayb*"),
  ["Shuayb", "shuayb", "shuaib", "shoaib", "shuayib", "shuaieb"],
  "markdown Shuayb still aliases after clean"
);
assertDeepEqual(
  jarvisNameSearchTerms("Shuaib"),
  ["Shuaib", "shuaib", "shuayb", "shoaib", "shuayib"],
  "Shuaib alias set (no shuaieb on this key)"
);

console.log("\nbuildJarvisNameOrFilter — PostgREST or structure");
assertEqual(buildJarvisNameOrFilter([]), "", "empty terms → empty filter");
assertEqual(
  buildJarvisNameOrFilter(["Ahmed"]),
  "push_name.ilike.%Ahmed%,inferred_name.ilike.%Ahmed%,source.ilike.%Ahmed%",
  "one term → push_name, inferred_name, source ilike"
);
assertEqual(
  buildJarvisNameOrFilter(["Shuayb", "shuayb"]),
  [
    "push_name.ilike.%Shuayb%",
    "inferred_name.ilike.%Shuayb%",
    "source.ilike.%Shuayb%",
    "push_name.ilike.%shuayb%",
    "inferred_name.ilike.%shuayb%",
    "source.ilike.%shuayb%",
  ].join(","),
  "two terms concatenate with commas"
);
assertEqual(
  buildJarvisNameOrFilter(["%foo_bar"]),
  "push_name.ilike.%foo bar%,inferred_name.ilike.%foo bar%,source.ilike.%foo bar%",
  "% and _ in a term become spaces before ilike"
);

console.log("\nmatchSavedList — saved CSV lists vs smart-callback phrasing");
const lists = [
  { name: "Downtown list", count: 12 },
  { name: "Marina owners", count: 8 },
];
assertEqual(
  matchSavedList(lists, "call my downtown list")?.name,
  "Downtown list",
  "call my downtown list matches the CSV list"
);
assertEqual(
  matchSavedList(lists, "call my marina owners")?.name,
  "Marina owners",
  "call my marina owners matches the CSV list"
);
assertEqual(
  matchSavedList(lists, "call everyone who mentioned a budget"),
  null,
  "smart-callback phrasing does not match unrelated CSV lists"
);
assertEqual(
  matchSavedList(lists, "people who asked about off-plan last week"),
  null,
  "intent-only callback phrasing does not match CSV lists"
);
assertEqual(matchSavedList([], "call my downtown list"), null, "empty catalog → no match");
assertEqual(
  matchSavedList([{ name: "budget", count: 3 }, ...lists], "call everyone who mentioned a budget")
    ?.name,
  "budget",
  "current behaviour: a CSV list whose name is a ≥4-char substring of the message still matches"
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

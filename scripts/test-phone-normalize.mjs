import {
  normalizePhone,
  maskPhone,
  buildPropertyInterest,
  resolveLeadSource,
} from "../src/lib/leads/normalize.js";

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

function assertNull(actual, label) {
  assertEqual(actual, null, label);
}

console.log("normalizePhone");
assertEqual(normalizePhone("9710554229317"), "+971554229317", "Pixxi 9710 stray zero");
assertEqual(normalizePhone("0554229317"), "+971554229317", "local 05XXXXXXXX");
assertEqual(normalizePhone("554229317"), "+971554229317", "bare 5XXXXXXXX");
assertEqual(normalizePhone("+971554229317"), "+971554229317", "E.164 with plus");
assertEqual(normalizePhone("971554229317"), "+971554229317", "digits with 971");
assertEqual(normalizePhone("  +971 55 422 9317  "), "+971554229317", "spaced E.164");
assertNull(normalizePhone(""), "empty string");
assertNull(normalizePhone("abc"), "non-numeric junk");
assertNull(normalizePhone("123"), "too short");
assertEqual(normalizePhone("+447911123456"), "+447911123456", "UK international");

console.log("\nmaskPhone");
const masked = maskPhone("+971554229317");
if (masked.includes("317") && masked.includes("***")) {
  passed += 1;
  console.log("  ok: masks middle digits");
} else {
  failed += 1;
  console.error(`  FAIL: maskPhone — got ${masked}`);
}

console.log("\nbuildPropertyInterest");
assertEqual(
  buildPropertyInterest({ rooms: "2", house_type: "Apartment", community: "Dubai Marina", budget: "1.5M AED" }),
  "2 bed, Apartment, Dubai Marina, around 1.5M AED",
  "full interest"
);
assertEqual(buildPropertyInterest({}), "your property enquiry", "empty interest");

console.log("\nresolveLeadSource");
assertEqual(resolveLeadSource({ client_source: "Bayut" }), "Bayut", "client_source");
assertEqual(resolveLeadSource({ custom_client_source: "Instagram" }), "Instagram", "custom_client_source");
assertEqual(resolveLeadSource({}), "one of the property portals", "default source");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

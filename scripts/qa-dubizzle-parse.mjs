/**
 * parseEnquiryEmail() unit tests (mocked Anthropic — no API key).
 *
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/qa-dubizzle-parse.mjs
 */
import { parseEnquiryEmail } from "../src/lib/dubizzle/parse-enquiry.js";

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

async function assertRejects(fn, expectedMessage, label) {
  try {
    await fn();
    failed += 1;
    console.error(`  FAIL: ${label}`);
    console.error("    expected throw, got success");
  } catch (error) {
    const message = error?.message || String(error);
    if (message === expectedMessage) {
      passed += 1;
      console.log(`  ok: ${label}`);
    } else {
      failed += 1;
      console.error(`  FAIL: ${label}`);
      console.error(`    expected message: ${JSON.stringify(expectedMessage)}`);
      console.error(`    actual message:   ${JSON.stringify(message)}`);
    }
  }
}

/** @param {object} payload Claude JSON body */
function mockAnthropicClient(payload, { textOverride = null } = {}) {
  const text =
    textOverride ??
    JSON.stringify(payload);
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text }],
      }),
    },
  };
}

console.log("parseEnquiryEmail (mocked Anthropic)");

console.log("\ngenuine enquiry + valid phone");
{
  const result = await parseEnquiryEmail({
    rawText: "New lead: Sarah Khan, 050 123 4567, asking about Marina 2BR",
    fromAddress: "noreply@dubizzle.com",
    client: mockAnthropicClient({
      is_enquiry: true,
      lead_name: "Sarah Khan",
      lead_phone: "050 123 4567",
      listing_title: "2 Bed Marina Gate",
      listing_url: "https://dubizzle.com/s/abc123",
      area: "Dubai Marina",
      price: "120000 AED",
    }),
  });
  assertEqual(result.status, "parsed", "status parsed");
  assertEqual(result.skip_reason, null, "no skip_reason");
  assertEqual(result.lead_phone, "+971501234567", "phone E.164");
  assertEqual(result.lead_name, "Sarah Khan", "lead_name preserved");
}

console.log("\ngenuine enquiry + missing phone");
{
  const result = await parseEnquiryEmail({
    rawText: "Lead wants viewing but no number given",
    fromAddress: "noreply@dubizzle.com",
    client: mockAnthropicClient({
      is_enquiry: true,
      lead_name: "Ali",
      lead_phone: null,
      listing_title: "Studio JVC",
      listing_url: null,
      area: "JVC",
      price: null,
    }),
  });
  assertEqual(result.status, "skipped", "status skipped (no phone)");
  assertEqual(result.skip_reason, "no_valid_phone", "skip_reason no_valid_phone");
  assertEqual(result.lead_phone, null, "lead_phone null");
}

console.log("\ngenuine enquiry + invalid phone");
{
  const result = await parseEnquiryEmail({
    rawText: "Call me back",
    fromAddress: "noreply@dubizzle.com",
    client: mockAnthropicClient({
      is_enquiry: true,
      lead_name: "Bob",
      lead_phone: "not-a-phone",
      listing_title: null,
      listing_url: null,
      area: null,
      price: null,
    }),
  });
  assertEqual(result.status, "skipped", "status skipped (invalid phone)");
  assertEqual(result.skip_reason, "no_valid_phone", "skip_reason invalid phone");
}

console.log("\nnon-enquiry (newsletter)");
{
  const result = await parseEnquiryEmail({
    rawText: "Weekly market roundup — unsubscribe at bottom",
    fromAddress: "news@dubizzle.com",
    client: mockAnthropicClient({
      is_enquiry: false,
      lead_name: null,
      lead_phone: null,
      listing_title: null,
      listing_url: null,
      area: null,
      price: null,
    }),
  });
  assertEqual(result.status, "skipped", "status skipped (not enquiry)");
  assertEqual(result.skip_reason, "not_an_enquiry", "skip_reason not_an_enquiry");
}

console.log("\nmarkdown fences stripped");
{
  const payload = {
    is_enquiry: true,
    lead_name: "Nina",
    lead_phone: "971501112223",
    listing_title: "Villa",
    listing_url: null,
    area: "Arabian Ranches",
    price: "3M",
  };
  const fenced = `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  const result = await parseEnquiryEmail({
    rawText: "body",
    client: mockAnthropicClient(payload, { textOverride: fenced }),
  });
  assertEqual(result.status, "parsed", "fenced JSON still parses");
  assertEqual(result.lead_phone, "+971501112223", "fenced JSON phone normalized");
}

console.log("\ninvalid JSON from Claude");
await assertRejects(
  () =>
    parseEnquiryEmail({
      rawText: "body",
      client: mockAnthropicClient({}, { textOverride: "Sure! Here is your data: {broken" }),
    }),
  "Dubizzle parse: Claude returned invalid JSON",
  "throws on invalid JSON"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

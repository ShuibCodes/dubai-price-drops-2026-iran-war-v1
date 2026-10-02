/**
 * Gmail forwarding verification detection (Dubizzle step 5).
 *
 *   node scripts/qa-dubizzle-gmail-verify.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  extractGmailVerificationCode,
  isGmailForwardingVerification,
  parseFromAddress,
} from "../src/lib/dubizzle/gmail-forwarding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

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

function assertTrue(value, label) {
  assertEqual(Boolean(value), true, label);
}

function assertFalse(value, label) {
  assertEqual(Boolean(value), false, label);
}

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

function parseSimpleFixture(raw) {
  const fromMatch = raw.match(/^From:\s*(.+)$/m);
  const subjectMatch = raw.match(/^Subject:\s*(.+)$/m);
  const bodyStart = raw.search(/\n\n/);
  const body = bodyStart >= 0 ? raw.slice(bodyStart + 2).trim() : raw;
  return {
    fromAddress: fromMatch?.[1]?.trim() || "",
    subject: subjectMatch?.[1]?.trim() || "",
    rawText: body,
  };
}

console.log("dubizzle gmail-forwarding");

console.log("\nparseFromAddress");
assertEqual(
  parseFromAddress("Gmail Team <forwarding-noreply@google.com>"),
  "forwarding-noreply@google.com",
  "display name + angle brackets"
);
assertEqual(
  parseFromAddress("forwarding-noreply@google.com"),
  "forwarding-noreply@google.com",
  "bare address"
);

console.log("\nGmail forwarding fixture");
const gmailFixture = parseSimpleFixture(readFixture("gmail-forwarding-verification.txt"));
assertTrue(
  isGmailForwardingVerification({ fromAddress: gmailFixture.fromAddress }),
  "gmail fixture identified as verification"
);
assertEqual(
  extractGmailVerificationCode({
    rawText: gmailFixture.rawText,
    subject: gmailFixture.subject,
  }),
  "847291053",
  "gmail fixture code extracted"
);

console.log("\ndubizzle enquiry fixture");
const dubizzleFixture = parseSimpleFixture(readFixture("dubizzle-enquiry-mock.txt"));
assertFalse(
  isGmailForwardingVerification({ fromAddress: dubizzleFixture.fromAddress }),
  "dubizzle enquiry not gmail verification"
);
assertEqual(
  extractGmailVerificationCode({
    rawText: dubizzleFixture.rawText,
    subject: dubizzleFixture.subject,
  }),
  null,
  "dubizzle enquiry yields no gmail code"
);

console.log("\nsimilar wrong sender");
const wrongFixture = parseSimpleFixture(readFixture("gmail-forwarding-wrong-sender.txt"));
assertFalse(
  isGmailForwardingVerification({ fromAddress: wrongFixture.fromAddress }),
  "noreply@google.com not forwarding-noreply"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

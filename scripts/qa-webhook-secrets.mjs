/**
 * Webhook shared-secret fail-closed behaviour — no live HTTP.
 *
 * node scripts/qa-webhook-secrets.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const { verifyConfiguredWebhookSecret } = await import(
  "../src/lib/security/webhook-secret.js"
);

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${detail || ""}`);
}

const SECRET = "test-webhook-secret";

console.log("\nCONFIGURED SECRET");
check(
  "valid secret is accepted",
  verifyConfiguredWebhookSecret({
    expected: SECRET,
    provided: SECRET,
    nodeEnv: "production",
  }) === true
);
check(
  "invalid secret is rejected",
  verifyConfiguredWebhookSecret({
    expected: SECRET,
    provided: "wrong",
    nodeEnv: "production",
  }) === false
);
check(
  "invalid secret is rejected in development too",
  verifyConfiguredWebhookSecret({
    expected: SECRET,
    provided: "wrong",
    nodeEnv: "development",
  }) === false
);

console.log("\nMISSING SECRET");
check(
  "missing secret in production is rejected",
  verifyConfiguredWebhookSecret({
    expected: "",
    provided: "anything",
    nodeEnv: "production",
  }) === false
);
check(
  "missing secret in development is allowed",
  verifyConfiguredWebhookSecret({
    expected: "",
    provided: "",
    nodeEnv: "development",
  }) === true
);
check(
  "unset secret in development is allowed",
  verifyConfiguredWebhookSecret({
    expected: undefined,
    provided: undefined,
    nodeEnv: "development",
  }) === true
);

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;

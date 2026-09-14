/**
 * /api/actions/call authz guard — no live Vapi dial.
 *
 * node scripts/qa-actions-call-guard.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const { actionsCallGuard } = await import("../src/lib/actions/call-guard.js");

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${detail || ""}`);
}

check(
  "anonymous is rejected",
  actionsCallGuard(null).status === 401
);
check(
  "agent without session ids is rejected",
  actionsCallGuard({ role: "admin" }).status === 401
);
check(
  "non-admin is forbidden",
  actionsCallGuard({
    agentId: "a1",
    tenantId: "t1",
    role: "agent",
  }).status === 403
);
check(
  "admin session is allowed",
  actionsCallGuard({
    agentId: "a1",
    tenantId: "t1",
    role: "admin",
  }).ok === true
);

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;

/**
 * Unknown-sender KB pending call/email confirmation.
 * Stubs the dial and email senders. No Supabase, no production send.
 *
 * node scripts/qa-kb-confirmation.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
register("./qa-kb-confirm-stub.mjs", import.meta.url);

for (const key of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_DB_PASSWORD",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "VAPI_API_KEY",
  "VAPI_ASSISTANT_ID",
  "VAPI_PHONE_NUMBER_ID",
  "VAPI_RELAY_ASSISTANT_ID",
]) {
  delete process.env[key];
}

const { defaultKbState, runKbTurn } = await import("../src/lib/kb/engine.js");
const { kbConfirmCalls, kbConfirmEmails, resetKbConfirmSinks } = await import(
  "./qa-kb-confirm-stub.mjs"
);

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const callerWaId = "971500009999";
const callLead = { name: "Omar Hassan", phone: "+971501110001", area: "Dubai" };
const emailDraft = {
  to: "omar@example.com",
  subject: "Viewing",
  body: "See you at 4.",
  leadName: "Omar Hassan",
};

function pendingCallState() {
  return {
    ...defaultKbState(),
    pendingCallRequest: { ...callLead },
    pendingConfirmationExpiry: Date.now() + 10 * 60 * 1000,
  };
}

function pendingEmailState() {
  return {
    ...defaultKbState(),
    pendingEmailDraft: { ...emailDraft },
    pendingConfirmationExpiry: Date.now() + 10 * 60 * 1000,
  };
}

function pendingStill(state, kind) {
  if (!(state.pendingConfirmationExpiry > Date.now())) return false;
  if (kind === "call") {
    return state.pendingCallRequest?.phone === callLead.phone && state.pendingEmailDraft == null;
  }
  return state.pendingEmailDraft?.to === emailDraft.to && state.pendingCallRequest == null;
}

async function turn(message, state) {
  resetKbConfirmSinks();
  return runKbTurn({
    callerWaId,
    state,
    messages: [{ role: "user", content: message }],
  });
}

const CALL_YES = ["yes", "yes.", "YES", "Yes!", "yeah", "yep", "y", "go ahead", " go ahead ", "go ahead.", "do it", "please do", "confirm", "send it", "resend", "retry"];
const CALL_NO = ["no", "no.", "NO", "nah", "nope"];
const NEITHER = [
  "yesterday was fine",
  "Please confirm the viewing time",
  "I think yes, but let me check",
  "don't do it",
  "I don't know",
  "not now",
  "yes, but wait",
  "nothing",
  "none",
  "okay",
  "ok",
  "sure",
];

console.log("\nKB PENDING CALL");
for (const word of CALL_YES) {
  const result = await turn(word, pendingCallState());
  check(
    `pending call ${JSON.stringify(word)} confirms once`,
    /Calling Omar Hassan now at \+971501110001/.test(result.text) &&
      result.text.includes("local-no-network") &&
      kbConfirmCalls().length === 1 &&
      kbConfirmCalls()[0].overridePhone === "+971501110001" &&
      kbConfirmEmails().length === 0 &&
      result.nextState.pendingCallRequest == null,
    result.text
  );
}

for (const word of CALL_NO) {
  const result = await turn(word, pendingCallState());
  check(
    `pending call ${JSON.stringify(word)} cancels`,
    result.text === "Pending action cancelled." &&
      kbConfirmCalls().length === 0 &&
      kbConfirmEmails().length === 0 &&
      result.nextState.pendingCallRequest == null &&
      result.nextState.pendingConfirmationExpiry == null,
    result.text
  );
}

for (const word of NEITHER) {
  const result = await turn(word, pendingCallState());
  check(
    `pending call ${JSON.stringify(word)} does not confirm or cancel`,
    result.text === "Please reply yes to place the call." &&
      kbConfirmCalls().length === 0 &&
      kbConfirmEmails().length === 0 &&
      pendingStill(result.nextState, "call"),
    result.text
  );
}

{
  resetKbConfirmSinks();
  const first = await runKbTurn({
    callerWaId,
    state: pendingCallState(),
    messages: [{ role: "user", content: "yesterday was fine" }],
  });
  const second = await runKbTurn({
    callerWaId,
    state: first.nextState,
    messages: [{ role: "user", content: "yes" }],
  });
  check(
    "yes after an ordinary sentence still places the pending call once",
    first.text === "Please reply yes to place the call." &&
      /Calling Omar Hassan/.test(second.text) &&
      kbConfirmCalls().length === 1 &&
      second.nextState.pendingCallRequest == null
  );
}

console.log("\nKB PENDING EMAIL");
for (const word of CALL_YES) {
  const result = await turn(word, pendingEmailState());
  check(
    `pending email ${JSON.stringify(word)} confirms once`,
    result.text === "Email sent to omar@example.com." &&
      kbConfirmEmails().length === 1 &&
      kbConfirmEmails()[0].to === "omar@example.com" &&
      kbConfirmCalls().length === 0 &&
      result.nextState.pendingEmailDraft == null,
    result.text
  );
}

for (const word of CALL_NO) {
  const result = await turn(word, pendingEmailState());
  check(
    `pending email ${JSON.stringify(word)} cancels`,
    result.text === "Pending action cancelled." &&
      kbConfirmEmails().length === 0 &&
      kbConfirmCalls().length === 0 &&
      result.nextState.pendingEmailDraft == null &&
      result.nextState.pendingConfirmationExpiry == null,
    result.text
  );
}

for (const word of NEITHER) {
  const result = await turn(word, pendingEmailState());
  check(
    `pending email ${JSON.stringify(word)} does not confirm or cancel`,
    result.text === "Please reply yes to send the email." &&
      kbConfirmEmails().length === 0 &&
      kbConfirmCalls().length === 0 &&
      pendingStill(result.nextState, "email"),
    result.text
  );
}

console.log("\nKB NO PENDING ACTION");
{
  const hello = await turn("hello", defaultKbState());
  for (const word of ["okay", "ok", "sure", "yesterday was fine", "I don't know", "not now", "I think yes"]) {
    const result = await turn(word, defaultKbState());
    check(
      `${JSON.stringify(word)} without a pending action stays on the ordinary path`,
      result.text === hello.text &&
        result.source === hello.source &&
        result.text !== "Please reply yes to place the call." &&
        result.text !== "Please reply yes to send the email." &&
        kbConfirmCalls().length === 0 &&
        kbConfirmEmails().length === 0 &&
        result.nextState.pendingCallRequest == null &&
        result.nextState.pendingEmailDraft == null,
      result.text
    );
  }
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nAll KB confirmation checks passed.");

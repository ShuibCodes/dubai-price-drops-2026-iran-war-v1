/**
 * Known-Jarvis MessageSid retries go through the durable conversation.
 * Unknown senders still use the in-memory sid cache.
 * No Supabase, Twilio, or production send.
 *
 * node scripts/qa-jarvis-sid.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
register("./qa-jarvis-sid-stub.mjs", import.meta.url);

for (const key of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_DB_PASSWORD",
  "ANTHROPIC_API_KEY",
  "RESEND_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "VAPI_API_KEY",
]) {
  delete process.env[key];
}

const { createSidStore } = await import("./qa-jarvis-sid-stub.mjs");
const { POST } = await import("../src/app/api/whatsapp/route.js");
const { hasProcessedMessageSid } = await import("../src/lib/whatsapp/state-store.js");

const JARVIS_FROM = "whatsapp:+971500009991";
const KB_FROM = "whatsapp:+971500008888";
const TO = "whatsapp:+971400000001";

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetDb() {
  globalThis.__jarvisSidDb = createSidStore();
  globalThis.__jarvisSidRest = true;
  globalThis.__jarvisSidSends = [];
  globalThis.__jarvisSidWaits = [];
  globalThis.__jarvisSidFailSend = false;
}

async function post(from, body, sid) {
  const form = new FormData();
  form.set("From", from);
  form.set("To", TO);
  form.set("Body", body);
  form.set("MessageSid", sid);
  const response = await POST(new Request("http://localhost/api/whatsapp", { method: "POST", body: form }));
  return response.text();
}

async function settle() {
  const pending = globalThis.__jarvisSidWaits.splice(0);
  await Promise.all(pending);
}

function users(sid) {
  return globalThis.__jarvisSidDb.messages.filter((row) => row.role === "user" && row.message_sid === sid);
}

function assistants() {
  return globalThis.__jarvisSidDb.messages.filter((row) => row.role === "assistant");
}

console.log("\nROUTE DUPLICATE DURING ACTIVE TURN");
{
  resetDb();
  let runs = 0;
  let releaseHold;
  const hold = new Promise((resolve) => {
    releaseHold = resolve;
  });
  let holding = false;
  globalThis.__jarvisSidRun = async () => {
    runs += 1;
    holding = true;
    await hold;
    return { text: "Saved answer" };
  };
  const first = post(JARVIS_FROM, "Question", "SM-OVERLAP");
  const started = Date.now();
  while (!holding && Date.now() - started < 2000) await sleep(5);
  const second = post(JARVIS_FROM, "Question", "SM-OVERLAP");
  await sleep(50);
  check("overlapping webhook does not run a second model", runs === 1 && holding);
  check(
    "overlapping Jarvis sid is not cached",
    hasProcessedMessageSid(JARVIS_FROM, "SM-OVERLAP") === false
  );
  releaseHold();
  await Promise.all([first, second]);
  await settle();
  check(
    "overlapping same SID keeps one user, one assistant, and one delivery",
    users("SM-OVERLAP").length === 1 &&
      assistants().length === 1 &&
      runs === 1 &&
      globalThis.__jarvisSidSends.length === 1 &&
      globalThis.__jarvisSidSends[0] === "Saved answer"
  );
}

console.log("\nROUTE AFTER MODEL FAILURE");
{
  resetDb();
  let runs = 0;
  globalThis.__jarvisSidRun = async () => {
    runs += 1;
    if (runs === 1) throw new Error("model down");
    return { text: "retry answer" };
  };
  await post(JARVIS_FROM, "Question", "SM-MODEL");
  await settle();
  check(
    "model failure leaves one user row and does not cache the sid",
    users("SM-MODEL").length === 1 &&
      assistants().length === 0 &&
      hasProcessedMessageSid(JARVIS_FROM, "SM-MODEL") === false
  );
  await post(JARVIS_FROM, "Question", "SM-MODEL");
  await settle();
  check(
    "same SID after model failure reruns the model without a second user row",
    users("SM-MODEL").length === 1 && runs === 2 && assistants().length === 1
  );
}

console.log("\nROUTE AFTER UNSENT ASSISTANT");
{
  resetDb();
  let runs = 0;
  globalThis.__jarvisSidFailSend = true;
  globalThis.__jarvisSidRun = async () => {
    runs += 1;
    return { text: "Saved answer" };
  };
  await post(JARVIS_FROM, "Question", "SM-UNSENT");
  await settle();
  const saved = assistants()[0];
  check(
    "failed send leaves the assistant unsent and the sid uncached",
    runs === 1 && saved && !saved.sent_at && hasProcessedMessageSid(JARVIS_FROM, "SM-UNSENT") === false
  );
  await post(JARVIS_FROM, "Question", "SM-UNSENT");
  await settle();
  check(
    "same SID delivers the saved body without a second model run",
    runs === 1 &&
      globalThis.__jarvisSidSends.length === 1 &&
      globalThis.__jarvisSidSends[0] === "Saved answer" &&
      Boolean(saved.sent_at)
  );
}

console.log("\nROUTE AFTER SUCCESSFUL SEND");
{
  resetDb();
  let runs = 0;
  globalThis.__jarvisSidRun = async () => {
    runs += 1;
    return { text: "Saved answer" };
  };
  await post(JARVIS_FROM, "Question", "SM-SENT");
  await settle();
  await post(JARVIS_FROM, "Question", "SM-SENT");
  await settle();
  check(
    "same SID after a sent reply does not send or run again",
    runs === 1 && globalThis.__jarvisSidSends.length === 1 && assistants().length === 1 && Boolean(assistants()[0].sent_at)
  );
}

console.log("\nROUTE DIFFERENT SIDS");
{
  resetDb();
  let runs = 0;
  globalThis.__jarvisSidRun = async () => {
    runs += 1;
    return { text: `answer ${runs}` };
  };
  await post(JARVIS_FROM, "hello", "SM-A");
  await settle();
  await post(JARVIS_FROM, "hello", "SM-B");
  await settle();
  const userRows = globalThis.__jarvisSidDb.messages.filter((row) => row.role === "user");
  check(
    "same body with different SIDs is two turns",
    userRows.length === 2 && runs === 2 && globalThis.__jarvisSidSends.length === 2
  );
}

console.log("\nUNKNOWN SENDER");
{
  resetDb();
  globalThis.__jarvisSidRest = false;
  globalThis.__kbSidTurns = 0;
  const first = await post(KB_FROM, "hello", "SM-KB");
  const second = await post(KB_FROM, "hello", "SM-KB");
  check(
    "unknown sender still answers the first sid",
    first.includes("You're not registered on AgentZero yet")
  );
  check("unknown sender caches that sid", hasProcessedMessageSid(KB_FROM, "SM-KB") === true);
  check(
    "unknown sender drops the duplicate sid",
    second.includes("<Message") === false && second.includes("registered") === false && globalThis.__kbSidTurns === 1
  );
  check(
    "unknown sender duplicate does not create a Jarvis user row",
    globalThis.__jarvisSidDb.messages.length === 0
  );
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nAll Jarvis MessageSid checks passed.");

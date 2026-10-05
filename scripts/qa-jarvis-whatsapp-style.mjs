/**
 * Jarvis WhatsApp tone and outbound truncation.
 * Truncation is local. Acknowledgement checks call the real Jarvis turn
 * with Supabase and Twilio left unset, so nothing is stored or sent.
 *
 * node scripts/qa-jarvis-whatsapp-style.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
register("./qa-confirm-fixtures.mjs", import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadAnthropicKey() {
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 1 || line.trim().startsWith("#")) continue;
    if (line.slice(0, eq).trim() !== "ANTHROPIC_API_KEY") continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env.ANTHROPIC_API_KEY = value;
  }
  for (const key of [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "VAPI_API_KEY",
    "VAPI_RELAY_ASSISTANT_ID",
    "VAPI_PHONE_NUMBER_ID",
    "VAPI_ASSISTANT_ID",
  ]) {
    delete process.env[key];
  }
}

loadAnthropicKey();

const { plainJarvisWhatsAppText, truncateWhatsAppBody } = await import(
  "../src/lib/whatsapp/twilio-send.js"
);
const { runJarvisTurn } = await import("../src/lib/jarvis/engine.js");
const { isJarvisAffirmative, isJarvisAmbiguousAck, isJarvisNegative } = await import(
  "../src/lib/jarvis/confirm.js"
);

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const TAIL = "\n\n(truncated — ask for more)";

function endsOnWordBoundary(original, sent) {
  if (!sent.endsWith("(truncated — ask for more)")) return false;
  const cut = sent.slice(0, sent.length - TAIL.length).trimEnd();
  if (!cut) return true;
  if (!original.startsWith(cut)) return false;
  const next = original[cut.length];
  return next == null || /\s/.test(next);
}

console.log("\nTRUNCATION");
{
  const sentence = "Call the client and confirm the viewing time. ";
  const long = sentence.repeat(80);
  const sent = truncateWhatsAppBody(long);
  check("long reply stays within 1500 characters", sent.length <= 1500, String(sent.length));
  check("truncated reply keeps the suffix", sent.endsWith("(truncated — ask for more)"));
  check("truncated reply ends on a sentence", /\.\n\n\(truncated — ask for more\)$/.test(sent));
  check("truncated reply does not split a word", endsOnWordBoundary(long, sent));
  check("short reply is unchanged aside from trim", truncateWhatsAppBody("  See you there.  ") === "See you there.");
}

{
  const word = "marigold ";
  const long = word.repeat(400);
  const sent = truncateWhatsAppBody(long.trim());
  const cut = sent.slice(0, sent.length - TAIL.length).trimEnd();
  check("no-sentence reply stays within 1500", sent.length <= 1500, String(sent.length));
  check("no-sentence reply uses the suffix", sent.includes("(truncated — ask for more)"));
  check("no-sentence reply ends on whitespace, not mid-word", cut === "" || cut.endsWith("marigold"));
  check("no-sentence cut is a real prefix", cut === "" || long.startsWith(cut));
}

{
  const sent = truncateWhatsAppBody("A".repeat(2000));
  check("single long word is not sliced", sent === "(truncated — ask for more)");
  check("single long word stays within budget", sent.length <= 1500);
}

{
  const exact = "B".repeat(1500);
  check("exact 1500 characters is unchanged", truncateWhatsAppBody(exact) === exact);
  const over = "C".repeat(1501);
  const overSent = truncateWhatsAppBody(over);
  check("1501 character word is not sliced", overSent === "(truncated — ask for more)");
  check("1501 character word stays within budget", overSent.length <= 1500);
}

{
  const emoji = `${"Hello. ".repeat(300)}😀`;
  const sent = truncateWhatsAppBody(emoji);
  check("emoji reply stays within 1500", sent.length <= 1500, String(sent.length));
  check("emoji reply does not split a word", endsOnWordBoundary(emoji, sent));
  check("emoji reply has no lone surrogate", !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(sent));
}

console.log("\nJARVIS FORMATTING");
{
  check("heading becomes the name", plainJarvisWhatsAppText("## Sarah") === "Sarah");
  check("bold name is unwrapped", plainJarvisWhatsAppText("**Sarah**") === "Sarah");
  check("apartment hash stays", plainJarvisWhatsAppText("apt #12") === "apt #12");
  check("numeric hash stays", plainJarvisWhatsAppText("#1416") === "#1416");
  check("lead hash stays", plainJarvisWhatsAppText("#lead-123") === "#lead-123");
  check("phone stays", plainJarvisWhatsAppText("+971501000002") === "+971501000002");
  check(
    "sentence hash stays",
    plainJarvisWhatsAppText("See unit #4 at 2pm.") === "See unit #4 at 2pm."
  );
  check(
    "generic truncator leaves embedded asterisks",
    truncateWhatsAppBody("AB**CD**99") === "AB**CD**99"
  );
  check(
    "Jarvis cleaner leaves embedded asterisks",
    plainJarvisWhatsAppText("AB**CD**99") === "AB**CD**99"
  );
}

console.log("\nGENERATED REPLIES");
const actor = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  agentId: "22222222-2222-4222-8222-222222222222",
  agentName: "Alex",
  senderPhone: "971500009999",
};
const prior = {
  role: "assistant",
  content: "Omar's number is +971501000001. He wants a marina viewing tomorrow.",
};

function offersUnaskedAction(text) {
  return /\b(call|save|search|look up)\b|want me to|would you like|shall i|just say the word|let me know if/i.test(
    text
  );
}

function leaksInternals(text) {
  return /\b(snapshot|vapi|twilio|supabase|anthropic)\b/i.test(text);
}

function startsWithMeta(text) {
  return /^(based on|from what i|from the information|according to|as mentioned)\b/i.test(
    String(text || "").trim()
  );
}

async function reply(messages) {
  const result = await runJarvisTurn({ ...actor, messages });
  return {
    text: truncateWhatsAppBody(plainJarvisWhatsAppText(result.text)),
    toolRounds: result.toolRounds,
  };
}

const knownOmar = {
  role: "assistant",
  content:
    "Omar Hassan is +971501110001. He wants a 2-bed in Dubai Marina. Budget AED 2,400,000. No reply has been sent yet.",
};
const knownSarah = {
  role: "assistant",
  content:
    "Sarah Khan is +971501110002. Budget AED 1,800,000 for a 1-bed in JVC. No reply has been sent yet.",
};

{
  const { text: sent } = await reply([knownOmar, { role: "user", content: "Tell me about Omar." }]);
  check(
    "Tell me about Omar does not offer a call",
    !offersUnaskedAction(sent) &&
      !leaksInternals(sent) &&
      !startsWithMeta(sent) &&
      /omar/i.test(sent),
    sent
  );
}
{
  const { text: sent } = await reply([
    knownSarah,
    { role: "user", content: "What's Sarah's budget?" },
  ]);
  check(
    "Sarah budget does not offer a call",
    !offersUnaskedAction(sent) && !leaksInternals(sent) && /1[,.]?800[,.]?000|1\.8/.test(sent),
    sent
  );
}

const ACK_KINDS = [
  ["Thanks", "gratitude"],
  ["Thank you", "gratitude"],
  ["Sure", "agreement"],
  ["Sounds good", "agreement"],
  ["Okay", "agreement"],
  ["Ok", "agreement"],
  ["Got it", "receipt"],
  ["Perfect", "receipt"],
];

for (const [word, kind] of ACK_KINDS) {
  const { text: sent, toolRounds } = await reply([prior, { role: "user", content: word }]);
  check(
    `${word} is one short line with no action`,
    !offersUnaskedAction(sent) &&
      !sent.includes("\n") &&
      sent.length < 80 &&
      toolRounds === 0,
    `rounds=${toolRounds} ${sent}`
  );
  check(`${word} outbound has no markdown heading or bold`, !sent.includes("**") && !/(^|\n)#{1,6}\s/.test(sent));
  if (kind === "gratitude") {
    check(
      `${word} is not answered as agreement`,
      !/^(great|sounds good|perfect|got it)\b/i.test(sent.trim()),
      sent
    );
  } else {
    check(`${word} is not answered as thanks`, !/^\s*anytime\b/i.test(sent), sent);
  }
}

{
  const { text: sent, toolRounds } = await reply([
    { role: "assistant", content: "Omar's viewing is tomorrow at 4." },
    { role: "user", content: "nah" },
  ]);
  check(
    "bare nah does not cancel or change the viewing",
    !/\b(cancel+ed|removed|deleted|rescheduled|no viewing)\b/i.test(sent) &&
      (!/\bviewing (is|has been) (off|called off)\b/i.test(sent) || sent.includes("?")) &&
      sent.length < 220 &&
      toolRounds === 0,
    `rounds=${toolRounds} ${sent}`
  );
}

{
  const routeSrc = readFileSync(join(ROOT, "src/app/api/whatsapp/route.js"), "utf8");
  const relaySrc = readFileSync(join(ROOT, "src/lib/jarvis/relay.js"), "utf8");
  check("no is still a confirmation negative", isJarvisNegative("no") && isJarvisNegative("nah"));
  check(
    "pending relay handles a negative before the model",
    /isJarvisNegative\(message\)[\s\S]{0,120}clearPendingRelay/.test(relaySrc) &&
      routeSrc.indexOf("handleRelayConfirmationMessage(") < routeSrc.indexOf("runJarvisTurn(")
  );
  const { text: sent, toolRounds } = await reply([
    { role: "user", content: "Call Omar." },
    {
      role: "assistant",
      content: "Ready to call Omar Hassan at +971501110001 — reply yes to place the call.",
    },
    { role: "user", content: "no" },
  ]);
  check(
    "no after a pending call prompt does not dial",
    !/placed the call|call is (queued|dialling|dialing)|I('ve| have) (called|dialled|dialed)|calling (him|omar) now/i.test(sent) &&
      !leaksInternals(sent) &&
      sent.length < 220 &&
      toolRounds === 0,
    `rounds=${toolRounds} ${sent}`
  );
}

{
  const { text: sent, toolRounds } = await reply([{ role: "user", content: "Call Omar" }]);
  const asksToConfirm = /reply\s+yes|explicit yes|ready to call|confirm/i.test(sent);
  const claimsDialled = /placed the call|call is (queued|dialling|dialing)|I('ve| have) (called|dialled|dialed)/i.test(sent);
  check(
    "Call Omar follows the confirmation or tool path",
    (asksToConfirm || toolRounds > 0) && !claimsDialled && !leaksInternals(sent),
    `rounds=${toolRounds} ${sent}`
  );
}

{
  const engineSrc = readFileSync(join(ROOT, "src/lib/jarvis/engine.js"), "utf8");
  const routeSrc = readFileSync(join(ROOT, "src/app/api/whatsapp/route.js"), "utf8");
  check(
    "yes still confirms a pending call",
    isJarvisAffirmative("yes", { allowCall: true }) === true
  );
  check(
    "Perfect does not confirm a pending call",
    isJarvisAffirmative("Perfect", { allowCall: true }) === false
  );
  check(
    "in-turn call gate still requires an affirmation",
    /case "start_target_call"[\s\S]{0,500}!latestUserAffirmed\(messages\)/.test(engineSrc)
  );
  check(
    "route still handles a pending relay before the model",
    /handleRelayConfirmationMessage\(/.test(routeSrc) &&
      routeSrc.indexOf("handleRelayConfirmationMessage(") < routeSrc.indexOf("runJarvisTurn(")
  );
  const { text: sent } = await reply([
    { role: "assistant", content: "Ready to call Omar. Reply yes to dial." },
    { role: "user", content: "yes" },
  ]);
  check(
    "yes after a pending call prompt stays on that call",
    !/^(anytime|got it|sure|no worries)\.?$/i.test(sent.trim()) &&
      /\b(omar|call|dial|phone)\b/i.test(sent) &&
      !/\bsave\b/i.test(sent) &&
      !leaksInternals(sent),
    sent
  );
}

{
  const { text: sent } = await reply([{ role: "user", content: "What's 15% of 2 million?" }]);
  check("ordinary answer has the figure", /300[,.]?000|300k/i.test(sent), sent);
  check("ordinary answer does not offer a call or save", !offersUnaskedAction(sent), sent);
  check("ordinary outbound has no markdown heading or bold", !sent.includes("**") && !/(^|\n)#{1,6}\s/.test(sent));
}

console.log("\nPENDING CONFIRMATION");
{
  const engineSrc = readFileSync(join(ROOT, "src/lib/jarvis/engine.js"), "utf8");
  const affirmed = engineSrc.match(/function latestUserAffirmed\(messages\) \{[\s\S]*?\n\}/);
  check(
    "in-turn call and email gate still accepts send it and call",
    Boolean(affirmed) && /send it/.test(affirmed[0]) && /\bcall\b/.test(affirmed[0])
  );
  check(
    "in-turn call and email gate still rejects okay, ok, and sure",
    Boolean(affirmed) && !/\bokay\b/.test(affirmed[0]) && !/\bsure\b/.test(affirmed[0]) && !/\bok\b/.test(affirmed[0])
  );
  for (const word of ["yes", "yeah", "yep", "y", "go ahead", "confirm", "confirmed", "do it", "proceed", "yup", "go"]) {
    check(`${word} still affirms a pending action`, isJarvisAffirmative(word, { allowCall: true }));
  }
  check("call still affirms a pending call", isJarvisAffirmative("call", { allowCall: true }));
  check("call does not affirm a pending save", isJarvisAffirmative("call", { allowSave: true }) === false);
  check("save still affirms a pending save", isJarvisAffirmative("save", { allowSave: true }));
  for (const word of ["okay", "ok", "sure", "Okay.", "OK", "Sure!"]) {
    check(`${word} does not affirm`, isJarvisAffirmative(word, { allowCall: true }) === false && isJarvisAffirmative(word, { allowSave: true }) === false);
    check(`${word} asks for explicit confirmation`, isJarvisAmbiguousAck(word) && isJarvisNegative(word) === false);
  }
  check(
    "ok thanks is left alone",
    isJarvisAffirmative("ok thanks", { allowCall: true }) === false &&
      isJarvisAmbiguousAck("ok thanks") === false &&
      isJarvisNegative("ok thanks") === false
  );

  const { installConfirmMemory, confirmDials, clearConfirmMemory } = await import(
    "./qa-confirm-fixtures.mjs"
  );
  const { handleRelayConfirmationMessage } = await import("../src/lib/jarvis/relay.js");
  const { handleContactConfirmationMessage } = await import("../src/lib/jarvis/contacts.js");
  const scope = {
    tenantId: actor.tenantId,
    agentId: actor.agentId,
    senderPhone: actor.senderPhone,
  };
  const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const relaySeed = () => ({
    sender_phone: actor.senderPhone,
    tenant_id: actor.tenantId,
    lead_id: null,
    phone_e164: "+971501110001",
    customer_name: "Omar Hassan",
    task: "the viewing is at 4",
    create_contact: false,
    expires_at: soon,
    created_at: new Date().toISOString(),
  });
  const contactSeed = () => ({
    sender_phone: actor.senderPhone,
    tenant_id: actor.tenantId,
    name: "Omar Hassan",
    phone_e164: "+971501110001",
    wa_id: "971501110001",
    expires_at: soon,
    created_at: new Date().toISOString(),
  });

  try {
    for (const word of ["yes", "yeah", "yep", "y", "go ahead", "confirm"]) {
      const db = installConfirmMemory({ ...scope, pendingRelay: relaySeed() });
      const result = await handleRelayConfirmationMessage({ ...scope, message: word });
      check(
        `pending call ${word} confirms without a real call`,
        result?.handled === true &&
          /Calling Omar Hassan at \+971501110001 now/.test(result.text) &&
          confirmDials().length === 1 &&
          confirmDials()[0].phoneE164 === "+971501110001" &&
          db.tables.jarvis_pending_relays.length === 0,
        result?.text
      );
      check(
        `pending call ${word} uses the local dial stub`,
        result?.dialed?.callId === "local-no-network"
      );
    }

    for (const word of ["okay", "ok", "sure"]) {
      const db = installConfirmMemory({ ...scope, pendingRelay: relaySeed() });
      const before = confirmDials().length;
      const result = await handleRelayConfirmationMessage({ ...scope, message: word });
      check(
        `pending call ${word} does not confirm`,
        result?.handled === true &&
          result.text === "Reply yes to place that call." &&
          !/won't|calling /i.test(result.text) &&
          confirmDials().length === before &&
          db.tables.jarvis_pending_relays.length === 1,
        result?.text
      );
    }

    {
      const db = installConfirmMemory({ ...scope, pendingRelay: relaySeed() });
      await handleRelayConfirmationMessage({ ...scope, message: "okay" });
      const result = await handleRelayConfirmationMessage({ ...scope, message: "yes" });
      check(
        "yes after okay still places the pending call once",
        /Calling Omar Hassan/.test(result?.text || "") &&
          confirmDials().length === 1 &&
          db.tables.jarvis_pending_relays.length === 0
      );
    }

    for (const word of ["nah", "no"]) {
      const db = installConfirmMemory({ ...scope, pendingRelay: relaySeed() });
      const result = await handleRelayConfirmationMessage({ ...scope, message: word });
      check(
        `pending call ${word} cancels`,
        result?.text === "Okay — I won't place that relay call." &&
          confirmDials().length === 0 &&
          db.tables.jarvis_pending_relays.length === 0,
        result?.text
      );
    }

    {
      const db = installConfirmMemory({ ...scope });
      const result = await handleRelayConfirmationMessage({ ...scope, message: "okay" });
      check(
        "okay with no pending call is not an action",
        result == null && confirmDials().length === 0 && db.tables.jarvis_pending_relays.length === 0
      );
    }

    for (const word of ["yes", "yeah", "yep", "y", "go ahead", "confirm"]) {
      const db = installConfirmMemory({ ...scope, pendingContact: contactSeed() });
      const result = await handleContactConfirmationMessage({ ...scope, message: word });
      check(
        `pending save ${word} confirms`,
        result?.handled === true &&
          /Saved Omar Hassan at \+971501110001/.test(result.text) &&
          confirmDials().length === 0 &&
          db.tables.jarvis_leads.length === 1 &&
          db.tables.jarvis_pending_contacts.length === 0,
        result?.text
      );
    }

    for (const word of ["okay", "ok", "sure"]) {
      const db = installConfirmMemory({ ...scope, pendingContact: contactSeed() });
      const result = await handleContactConfirmationMessage({ ...scope, message: word });
      check(
        `pending save ${word} does not confirm`,
        result?.text === "Reply yes to save that contact." &&
          confirmDials().length === 0 &&
          db.tables.jarvis_leads.length === 0 &&
          db.tables.jarvis_pending_contacts.length === 1,
        result?.text
      );
    }

    for (const word of ["nah", "no"]) {
      const db = installConfirmMemory({ ...scope, pendingContact: contactSeed() });
      const result = await handleContactConfirmationMessage({ ...scope, message: word });
      check(
        `pending save ${word} cancels`,
        result?.text === "Okay — I won't save that contact." &&
          db.tables.jarvis_leads.length === 0 &&
          db.tables.jarvis_pending_contacts.length === 0,
        result?.text
      );
    }

    {
      const db = installConfirmMemory({ ...scope });
      const result = await handleContactConfirmationMessage({ ...scope, message: "sure" });
      check(
        "sure with no pending save is not an action",
        result == null && db.tables.jarvis_leads.length === 0 && confirmDials().length === 0
      );
    }
  } finally {
    clearConfirmMemory();
  }
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nAll Jarvis WhatsApp style checks passed.");

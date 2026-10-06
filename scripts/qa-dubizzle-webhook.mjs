/**
 * Dubizzle inbound webhook (step 4) + Resend signature (step 3).
 *
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/qa-dubizzle-webhook.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createDubizzleDb } from "./qa-dubizzle-db-stub.mjs";
import { handleDubizzleInbound } from "../src/lib/dubizzle/webhook.js";
import { signResendWebhookPayload } from "../src/lib/email/resend-receiving.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET = `whsec_${Buffer.from("dubizzle-test-secret").toString("base64")}`;
const FIXTURE_PATH = path.join(__dirname, "fixtures/resend-email-received.json");

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok: ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function fixturePayload(overrides = {}) {
  const base = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  return {
    ...base,
    data: { ...base.data, ...overrides },
  };
}

function signedHeaders(payload) {
  const signed = signResendWebhookPayload(payload, SECRET);
  return {
    headers: {
      "svix-id": signed.id,
      "svix-timestamp": signed.timestamp,
      "svix-signature": signed.signature,
    },
    rawBody: signed.body,
  };
}

function seedDb() {
  const db = createDubizzleDb();
  db.rows.tenants.push({
    id: "t-sterling",
    slug: "sterling",
    inbound_email: "sterling-k8f3x2@leads.agentzero.ae",
  });
  db.rows.tenants.push({
    id: "t-1416",
    slug: "1416",
    inbound_email: "1416-aaaaaa@leads.agentzero.ae",
  });
  return db;
}

async function run(db, payload, extra = {}) {
  const { headers, rawBody } = signedHeaders(payload);
  return handleDubizzleInbound({
    rawBody,
    headers,
    supabase: db,
    webhookSecret: SECRET,
    fetchBody: async () => "fetched body",
    waitUntil: extra.waitUntil,
    ...extra,
  });
}

console.log("dubizzle webhook");

console.log("\nsignature");
{
  const db = seedDb();
  const payload = fixturePayload();
  const signed = signResendWebhookPayload(payload, SECRET);

  const valid = await handleDubizzleInbound({
    rawBody: signed.body,
    headers: {
      "svix-id": signed.id,
      "svix-timestamp": signed.timestamp,
      "svix-signature": signed.signature,
    },
    supabase: db,
    webhookSecret: SECRET,
    fetchBody: async () => "body",
    waitUntil: () => {},
  });
  check("valid signature accepted", valid.status === 200 && valid.body.ok === true);

  const invalid = await handleDubizzleInbound({
    rawBody: signed.body,
    headers: {
      "svix-id": signed.id,
      "svix-timestamp": signed.timestamp,
      "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
    supabase: db,
    webhookSecret: SECRET,
    waitUntil: () => {},
  });
  check("invalid signature rejected", invalid.status === 401);

  const missing = await handleDubizzleInbound({
    rawBody: signed.body,
    headers: {},
    supabase: db,
    webhookSecret: SECRET,
    waitUntil: () => {},
  });
  check("missing signature rejected", missing.status === 401);

  const noSecret = await handleDubizzleInbound({
    rawBody: signed.body,
    headers: {
      "svix-id": signed.id,
      "svix-timestamp": signed.timestamp,
      "svix-signature": signed.signature,
    },
    supabase: db,
    webhookSecret: "",
    waitUntil: () => {},
  });
  check("missing secret fail-closed", noSecret.status === 401);
}

console.log("\nevent + recipient");
{
  const db = seedDb();
  const wrongType = await run(db, { type: "email.sent", data: fixturePayload().data });
  check("wrong event type ignored", wrongType.status === 200 && wrongType.body.ignored === true);
  check("wrong event type inserts nothing", db.rows.inbound_leads.length === 0);

  const unknown = await run(
    db,
    fixturePayload({ to: ["nobody@leads.agentzero.ae"], email_id: "email-unknown" })
  );
  check("unknown recipient 200", unknown.status === 200 && unknown.body.ignored === true);
  check("unknown recipient inserts nothing", db.rows.inbound_leads.length === 0);

  db.rows.retired_inbound_emails.push({
    email: "sterling-oldold@leads.agentzero.ae",
    tenant_id: "t-sterling",
  });
  const retired = await run(
    db,
    fixturePayload({
      to: ["sterling-oldold@leads.agentzero.ae"],
      email_id: "email-retired",
    })
  );
  check("retired address 200 no lead", retired.status === 200 && retired.body.ignored === true);
  check(
    "retired does not create inbound_leads",
    !db.rows.inbound_leads.some((row) => row.resend_email_id === "email-retired")
  );
}

console.log("\ntenant isolation + dedupe + async body");
{
  const db = seedDb();
  let bodyFinished = false;
  const jobs = [];
  const payload = fixturePayload({ email_id: "email-1" });
  const first = await handleDubizzleInbound({
    ...signedHeaders(payload),
    supabase: db,
    webhookSecret: SECRET,
    fetchBody: () =>
      new Promise((resolve) => {
        setTimeout(() => {
          bodyFinished = true;
          resolve("async body");
        }, 40);
      }),
    waitUntil: (pending) => jobs.push(pending),
  });
  check("correct tenant recipient", first.status === 200 && first.body.tenant === "sterling");
  check("inserted received", db.rows.inbound_leads[0]?.status === "received");
  check(
    "row belongs to sterling not 1416",
    db.rows.inbound_leads[0]?.tenant_id === "t-sterling"
  );
  check("webhook returned before body fetch finished", bodyFinished === false);
  check("raw_text empty until async attach", db.rows.inbound_leads[0]?.raw_text == null);

  await Promise.all(jobs);
  check("async attach wrote raw_text", db.rows.inbound_leads[0]?.raw_text === "async body");

  const dup = await run(db, payload, { waitUntil: () => {} });
  check("duplicate resend_email_id 200", dup.status === 200 && dup.body.duplicate === true);
  check("duplicate does not insert a second row", db.rows.inbound_leads.length === 1);

  const other = await run(
    db,
    fixturePayload({
      email_id: "email-1416",
      to: ["1416-aaaaaa@leads.agentzero.ae"],
    }),
    { waitUntil: () => {} }
  );
  check("second tenant gets its own row", other.body.tenant === "1416");
  check(
    "two tenants isolated",
    db.rows.inbound_leads.filter((row) => row.tenant_id === "t-1416").length === 1 &&
      db.rows.inbound_leads.filter((row) => row.tenant_id === "t-sterling").length === 1
  );
}

console.log("\nno call / parse / vapi from webhook path");
{
  const files = [
    "src/lib/dubizzle/webhook.js",
    "src/app/api/inbound/dubizzle/route.js",
    "src/lib/dubizzle/inbound-email.js",
    "src/lib/dubizzle/tenant-by-inbound-email.js",
    "src/lib/email/resend-receiving.js",
  ];
  const banned = [
    "upsertInboundLead",
    "dialOrQueueLead",
    "dialLeadNow",
    "startLeadCall",
    "parseEnquiryEmail",
    "@anthropic-ai",
    "claude",
    "vapi/dial",
    "assertOutboundActive",
  ];
  const root = path.join(__dirname, "..");
  let clean = true;
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    for (const token of banned) {
      if (src.toLowerCase().includes(token.toLowerCase())) {
        clean = false;
        console.error(`  banned "${token}" in ${rel}`);
      }
    }
  }
  check("webhook path does not import dial/parse/Vapi", clean);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

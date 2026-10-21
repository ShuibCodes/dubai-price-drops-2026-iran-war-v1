/**
 * Inbound address allocate / retire / collision (Dubizzle step 2).
 *
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/qa-dubizzle-address.mjs
 */
import { createDubizzleDb } from "./qa-dubizzle-db-stub.mjs";
import {
  allocateInboundEmail,
  generateInboundEmail,
  listTenantsMissingInboundEmail,
  normalizeInboundAddress,
  retireInboundEmail,
  sanitizeTenantSlug,
} from "../src/lib/dubizzle/inbound-email.js";

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

console.log("dubizzle inbound addresses");

console.log("\ngenerateInboundEmail");
{
  const email = generateInboundEmail("Sterling Blvd", { token: "k8f3x2" });
  check(
    "slug sanitized + token + domain",
    email === "sterlingblvd-k8f3x2@leads.agentzero.ae",
    email
  );
  check(
    "1416 slug",
    generateInboundEmail("1416", { token: "abc123" }) ===
      "1416-abc123@leads.agentzero.ae"
  );
  check("empty slug becomes tenant", sanitizeTenantSlug("") === "tenant");
  check(
    "normalize angle brackets",
    normalizeInboundAddress("Name <A@Leads.AgentZero.ae>") ===
      "a@leads.agentzero.ae"
  );
}

console.log("\nallocate + never reuse retired + collision");
{
  const db = createDubizzleDb();
  db.rows.tenants.push(
    { id: "t-sterling", slug: "sterling", inbound_email: null },
    {
      id: "t-1416",
      slug: "1416",
      inbound_email: "sterling-taken1@leads.agentzero.ae",
    }
  );
  db.rows.retired_inbound_emails.push({
    email: "sterling-dead01@leads.agentzero.ae",
    tenant_id: "t-sterling",
  });

  const tokens = ["dead01", "taken1", "free99"];
  let i = 0;
  const email = await allocateInboundEmail(db, "t-sterling", {
    createToken: () => tokens[i++] || `z${i}`,
  });
  check(
    "skips retired and taken tokens",
    email === "sterling-free99@leads.agentzero.ae",
    email
  );
  check(
    "does not steal the occupied address",
    db.rows.tenants.find((row) => row.id === "t-1416").inbound_email ===
      "sterling-taken1@leads.agentzero.ae"
  );
}

console.log("\nregenerate retires old and isolates tenants");
{
  const db = createDubizzleDb();
  db.rows.tenants.push(
    {
      id: "t-a",
      slug: "alpha",
      inbound_email: "alpha-oldold@leads.agentzero.ae",
    },
    {
      id: "t-b",
      slug: "beta",
      inbound_email: "beta-keepme@leads.agentzero.ae",
    }
  );

  const next = await retireInboundEmail(db, "t-a", {
    createToken: () => "newone",
  });
  check(
    "regenerate assigns new address",
    next === "alpha-newone@leads.agentzero.ae",
    next
  );
  check(
    "old address retired",
    db.rows.retired_inbound_emails.some(
      (row) => row.email === "alpha-oldold@leads.agentzero.ae"
    )
  );
  check(
    "other tenant unchanged",
    db.rows.tenants.find((row) => row.id === "t-b").inbound_email ===
      "beta-keepme@leads.agentzero.ae"
  );

  db.rows.tenants.find((row) => row.id === "t-a").inbound_email = null;
  let threw = false;
  try {
    await allocateInboundEmail(db, "t-a", { createToken: () => "oldold" });
  } catch {
    threw = true;
  }
  const reused = db.rows.tenants.find((row) => row.id === "t-a").inbound_email;
  check(
    "retired address not reused",
    threw || reused !== "alpha-oldold@leads.agentzero.ae",
    reused
  );
}

console.log("\nbackfill lists only missing");
{
  const db = createDubizzleDb();
  db.rows.tenants.push(
    { id: "t-1", slug: "one", inbound_email: null },
    { id: "t-2", slug: "two", inbound_email: "two-aaaaaa@leads.agentzero.ae" }
  );
  const missing = await listTenantsMissingInboundEmail(db);
  check("backfill lists one missing tenant", missing.length === 1, String(missing.length));
  check("backfill id is the tenant without address", missing[0].id === "t-1");
}

console.log("\nno default tenant");
{
  const db = createDubizzleDb();
  db.rows.tenants.push({
    id: "t-fallback",
    slug: "sterling",
    inbound_email: "sterling-zzzzzz@leads.agentzero.ae",
  });
  let threw = false;
  try {
    await allocateInboundEmail(db, "missing-id");
  } catch {
    threw = true;
  }
  check("unknown tenantId throws instead of falling back", threw);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

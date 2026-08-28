// One-off: create the az-test tenant and its test-auth agent, used to exercise
// the Supabase Auth migration without touching a production tenant.
//
//   node scripts/create-test-agent.mjs            plan only, no writes
//   node scripts/create-test-agent.mjs --commit   apply
//
// The email is typed in at the prompt so it never reaches the repo, .env.local,
// or shell history, and is only ever echoed back redacted.
//
// Every write is keyed on username 'test-auth' within tenant 'az-test' and
// asserts exactly one affected row. The four production agents are read once to
// prove they are unchanged and are never targeted by a write.

import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

const TENANT_SLUG = "az-test";
const USERNAME = "test-auth";

const TENANT_FIELDS = {
  slug: TENANT_SLUG,
  name: "AgentZero Auth Test",
  waba_id: null,
  phone_number_id: null,
  business_token: null,
};

const AGENT_FIELDS = {
  username: USERNAME,
  name: "Auth Migration Test",
  role: "agent",
  password_hash: null,
  wa_id: null,
  brief_enabled: false,
  tz: "Asia/Dubai",
};

const PROTECTED_USERNAMES = ["ghl", "naheem", "salmaan", "shuayb"];
const PROTECTED_TENANT_SLUGS = ["1416", "condo-city", "ghl-courses", "sterling"];
const PRODUCTION_SNAPSHOT_COLS = "id, username, tenant_id, role, brief_enabled";

const COMMIT = process.argv.includes("--commit");

function redact(email) {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

// Deliberately not exhaustive; it only has to catch a fat-fingered entry before
// the address becomes an authentication identifier.
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function likeEscape(value) {
  return value.replace(/[%_\\]/g, "\\$&");
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptEmail() {
  const email = await ask("Test agent email (not stored anywhere but the DB): ");
  if (!validEmail(email)) {
    throw new Error("That does not look like an email address. Nothing was written.");
  }
  console.log(`\n  ${USERNAME} on ${TENANT_SLUG} will sign in as ${redact(email)}`);
  const confirmed = await ask("  Correct? type yes to continue: ");
  if (confirmed.toLowerCase() !== "yes") {
    throw new Error("Cancelled. Nothing was written.");
  }
  return email;
}

async function snapshotProductionAgents(supabase) {
  const { data, error } = await supabase
    .from("agents")
    .select(PRODUCTION_SNAPSHOT_COLS)
    .in("username", ["ghl", "Naheem", "Salmaan", "shuayb"])
    .order("username");
  if (error) throw new Error(`Production snapshot failed: ${error.message}`);
  return JSON.stringify(data);
}

async function resolveTenant(supabase) {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, name, waba_id, phone_number_id, business_token")
    .eq("slug", TENANT_SLUG)
    .maybeSingle();
  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  if (!data) return null;

  if (PROTECTED_TENANT_SLUGS.includes(data.slug)) {
    throw new Error(`Refusing to touch production tenant "${data.slug}".`);
  }
  const connected = ["waba_id", "phone_number_id", "business_token"].filter(
    (key) => data[key]
  );
  if (connected.length) {
    throw new Error(
      `Tenant ${TENANT_SLUG} already has ${connected.join(", ")} set. ` +
        "The test tenant must stay disconnected from WhatsApp — resolve by hand."
    );
  }
  return data;
}

async function createTenant(supabase) {
  const { data, error } = await supabase
    .from("tenants")
    .insert(TENANT_FIELDS)
    .select("id, slug")
    .single();
  if (error) throw new Error(`Tenant insert failed: ${error.message}`);
  return data;
}

async function resolveTestAgent(supabase) {
  const { data, error } = await supabase
    .from("agents")
    .select("id, username, tenant_id, role, brief_enabled, wa_id")
    .ilike("username", likeEscape(USERNAME))
    .maybeSingle();
  if (error) throw new Error(`Agent lookup failed: ${error.message}`);
  if (!data) return null;

  // The write path below is keyed on this id, so prove it is the test row.
  if (String(data.username).toLowerCase() !== USERNAME) {
    throw new Error(`Expected username "${USERNAME}", got "${data.username}". Aborting.`);
  }
  if (PROTECTED_USERNAMES.includes(String(data.username).toLowerCase())) {
    throw new Error(`Refusing to write to production agent "${data.username}".`);
  }
  return data;
}

// agents_email_lower_unique (migration 024) would reject a duplicate anyway;
// this reports it as a readable error instead of a constraint violation, and
// works whether or not that migration has been applied yet.
async function assertEmailFree(supabase, email) {
  const { data, error } = await supabase
    .from("agents")
    .select("id, username")
    .ilike("email", likeEscape(email));
  if (error) throw new Error(`Email check failed: ${error.message}`);
  const clash = (data || []).find(
    (row) => String(row.username).toLowerCase() !== USERNAME
  );
  if (clash) {
    throw new Error(
      `${redact(email)} is already on agent "${clash.username}". Aborting.`
    );
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(COMMIT ? "Mode: COMMIT\n" : "Mode: dry run (pass --commit to apply)\n");

  const before = await snapshotProductionAgents(supabase);
  const email = await promptEmail();
  await assertEmailFree(supabase, email);

  let tenant = await resolveTenant(supabase);
  const agent = await resolveTestAgent(supabase);
  if (agent && tenant && agent.tenant_id !== tenant.id) {
    throw new Error(`Agent "${USERNAME}" belongs to another tenant. Aborting.`);
  }

  console.log("\nPlan");
  console.log(
    `  tenant ${TENANT_SLUG}  ${tenant ? `reuse (${tenant.id})` : "insert"}` +
      "  waba_id=null phone_number_id=null business_token=null"
  );
  console.log(`  agent  ${USERNAME}   ${agent ? `update (${agent.id})` : "insert"}`);
  for (const [field, value] of Object.entries(AGENT_FIELDS)) {
    console.log(`    ${field.padEnd(14)} ${value === null ? "null" : value}`);
  }
  console.log(`    ${"email".padEnd(14)} ${redact(email)}`);

  if (!COMMIT) {
    console.log("\nDry run — nothing written. Re-run with --commit to apply.");
    return;
  }

  if (!tenant) tenant = await createTenant(supabase);

  const payload = { ...AGENT_FIELDS, email, tenant_id: tenant.id };
  const written = agent
    ? await supabase.from("agents").update(payload).eq("id", agent.id).select("id")
    : await supabase.from("agents").insert(payload).select("id");
  if (written.error) throw new Error(`Agent write failed: ${written.error.message}`);
  if (written.data?.length !== 1) {
    throw new Error(
      `Expected 1 affected row, got ${written.data?.length ?? 0}. Inspect by hand.`
    );
  }

  const after = await snapshotProductionAgents(supabase);
  if (after !== before) {
    throw new Error("Production agent rows changed. Investigate immediately.");
  }

  const { data: final, error: finalError } = await supabase
    .from("agents")
    .select("id, username, name, role, brief_enabled, tz, wa_id, password_hash, tenant_id")
    .eq("id", written.data[0].id)
    .single();
  if (finalError) throw new Error(`Verify failed: ${finalError.message}`);

  console.log("\nWritten");
  console.log(`  agent id        ${final.id}`);
  console.log(`  tenant          ${TENANT_SLUG} (${final.tenant_id})`);
  console.log(`  username        ${final.username}`);
  console.log(`  name            ${final.name}`);
  console.log(`  role            ${final.role}`);
  console.log(`  email           ${redact(email)}`);
  console.log(`  password_hash   ${final.password_hash === null ? "null" : "SET — unexpected"}`);
  console.log(`  wa_id           ${final.wa_id === null ? "null" : "SET — unexpected"}`);
  console.log(`  brief_enabled   ${final.brief_enabled}`);
  console.log(`  tz              ${final.tz}`);
  console.log("\nProduction agents unchanged. auth_user_id stays null until first sign-in.");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

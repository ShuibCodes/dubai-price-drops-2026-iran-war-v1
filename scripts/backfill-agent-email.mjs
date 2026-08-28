// Sets agents.email for one existing agent, one run at a time. That address is
// the allowlist key the Google callback matches on, so an agent stays on the
// legacy password form until it is filled in — this is the per-agent migration
// switch, and there is no bulk mode on purpose.
//
//   node scripts/backfill-agent-email.mjs            plan only, no writes
//   node scripts/backfill-agent-email.mjs --commit   apply
//
// Username and email are typed in at the prompt so no address reaches the repo,
// .env.local, or shell history, and both are echoed back redacted.
//
// No Supabase Auth user is created here. Google sign-in mints one and the
// callback links it, which avoids pre-creating a passwordless user and relying
// on provider identity auto-linking.

import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

const COMMIT = process.argv.includes("--commit");
const SNAPSHOT_COLS = "id, username, tenant_id, role";

function redact(email) {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

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

async function findAgent(supabase, username) {
  const { data, error } = await supabase
    .from("agents")
    .select("id, username, email, role, auth_user_id, tenants!inner(id, slug)")
    .ilike("username", likeEscape(username))
    .maybeSingle();
  if (error) throw new Error(`Agent lookup failed: ${error.message}`);
  return data || null;
}

async function snapshotOthers(supabase, keepId) {
  const { data, error } = await supabase
    .from("agents")
    .select(SNAPSHOT_COLS)
    .neq("id", keepId)
    .order("username");
  if (error) throw new Error(`Snapshot failed: ${error.message}`);
  return JSON.stringify(data);
}

async function assertEmailFree(supabase, email, agentId) {
  const { data, error } = await supabase
    .from("agents")
    .select("id, username")
    .ilike("email", likeEscape(email));
  if (error) throw new Error(`Email check failed: ${error.message}`);
  const clash = (data || []).find((row) => row.id !== agentId);
  if (clash) {
    throw new Error(`${redact(email)} is already on agent "${clash.username}". Aborting.`);
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

  const username = await ask("Agent username: ");
  if (!username) throw new Error("No username given. Nothing was written.");

  const agent = await findAgent(supabase, username);
  if (!agent) throw new Error(`No agent with username "${username}". Nothing was written.`);

  console.log(`\n  ${agent.username} on ${agent.tenants.slug} (role ${agent.role})`);
  console.log(`  current email: ${agent.email ? redact(agent.email) : "none"}`);

  // A linked agent must not have its email re-pointed: the old Google account
  // would stop matching any agent, and the new address's owner would hit the
  // link-conflict guard in the callback — locking the agent out both ways.
  if (agent.auth_user_id) {
    throw new Error(
      `"${agent.username}" is already linked to a Supabase Auth user ` +
        `(auth_user_id is set). Changing the email now would lock this agent out ` +
        `of Google sign-in entirely.\n` +
        `To re-point the email deliberately: clear agents.auth_user_id for this ` +
        `agent (and delete the stale Supabase Auth user in the dashboard), then ` +
        `re-run this script. Nothing was written.`
    );
  }

  if (agent.email) {
    console.log("  this agent can already use Google sign-in — overwriting changes it");
  }

  const email = await ask("\nNew email: ");
  if (!validEmail(email)) {
    throw new Error("That does not look like an email address. Nothing was written.");
  }
  await assertEmailFree(supabase, email, agent.id);

  console.log(
    `\n  ${agent.username} will sign in with Google as ${redact(email)}` +
      `\n  and land on /copilot/${agent.tenants.slug}`
  );
  const confirmed = await ask("  Correct? type yes to continue: ");
  if (confirmed.toLowerCase() !== "yes") {
    throw new Error("Cancelled. Nothing was written.");
  }

  if (!COMMIT) {
    console.log("\nDry run — nothing written. Re-run with --commit to apply.");
    return;
  }

  const before = await snapshotOthers(supabase, agent.id);

  const written = await supabase
    .from("agents")
    .update({ email })
    .eq("id", agent.id)
    .select("id");
  if (written.error) throw new Error(`Update failed: ${written.error.message}`);
  if (written.data?.length !== 1) {
    throw new Error(
      `Expected 1 affected row, got ${written.data?.length ?? 0}. Inspect by hand.`
    );
  }

  const after = await snapshotOthers(supabase, agent.id);
  if (after !== before) {
    throw new Error("Other agent rows changed. Investigate immediately.");
  }

  console.log(`\nWritten. ${agent.username} -> ${redact(email)}`);
  console.log("Other agents unchanged. They stay on the password form.");
  console.log(
    "\nThis agent keeps their password login too until you clear password_hash."
  );
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { twilioAzDecision, metaInboundDecision } from "../src/lib/jarvis/az-gate.js";
import { senderOwnsTenant } from "../src/lib/jarvis/private-line.js";

applyEnv(loadEnvFile());

const SHUAYB = "971585690693";
const UBAH = "971561311906";
const STRANGER = "971500000099";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function runGateTests() {
  const shuayb = { tenantId: "sterling-id", tenantSlug: "sterling", waId: SHUAYB };
  const ubah = { tenantId: "ubah-id", tenantSlug: "ubah", waId: UBAH };

  assert(twilioAzDecision(shuayb).action === "jarvis", "Shuayb on AZ must stay Jarvis");
  assert(twilioAzDecision(shuayb).tenantId === "sterling-id", "Shuayb must stay on Sterling");
  assert(twilioAzDecision(ubah).action === "jarvis", "Ubahh on AZ is Jarvis for her tenant");
  assert(twilioAzDecision(ubah).tenantId === "ubah-id", "Ubahh must not land on Sterling");
  assert(twilioAzDecision(null).action === "silent", "Stranger on AZ must be silent");
  assert(twilioAzDecision({}).action === "silent", "Empty sender must be silent");

  assert(
    metaInboundDecision({ sender: ubah, tenantId: "ubah-id", message: { type: "text" } }).action ===
      "copilot",
    "Ubahh texting her own WABA is copilot"
  );
  assert(
    metaInboundDecision({ sender: shuayb, tenantId: "ubah-id", message: { type: "text" } }).action ===
      "ingest",
    "Shuayb texting Ubahh's number is a lead, not his copilot"
  );
  assert(
    metaInboundDecision({ sender: ubah, tenantId: "sterling-id", message: { type: "text" } }).action ===
      "ingest",
    "Ubahh texting 93 is a Sterling lead, not her inbox"
  );
  assert(
    metaInboundDecision({ sender: null, tenantId: "sterling-id", message: { type: "text" } }).action ===
      "ingest",
    "Stranger texting 93 is a lead, no Jarvis"
  );
  assert(
    metaInboundDecision({
      sender: shuayb,
      tenantId: "sterling-id",
      message: { type: "text", context: { id: "wamid.lead-thread" } },
    }).action === "ingest",
    "Shuayb reply in a lead thread must stay ingest, not steal copilot"
  );
  assert(senderOwnsTenant(ubah, "ubah-id") === true, "owner check true");
  assert(senderOwnsTenant(ubah, "sterling-id") === false, "owner check false across tenants");
  assert(senderOwnsTenant(null, "sterling-id") === false, "owner check false for stranger");

  console.log("gate: ok");
}

async function runDbTests() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: agents, error } = await supabase
    .from("agents")
    .select("name, wa_id, tenant_id, tenants!inner(slug)")
    .in("wa_id", [SHUAYB, UBAH]);
  if (error) throw new Error(error.message);

  const shuayb = agents.find((row) => row.wa_id === SHUAYB);
  const ubah = agents.find((row) => row.wa_id === UBAH);
  assert(shuayb?.tenants?.slug === "sterling", "Shuayb must remain the Sterling agent");
  assert(ubah?.tenants?.slug === "ubah", "Ubahh must stay on ubah, not Sterling");
  assert(shuayb.tenant_id !== ubah.tenant_id, "Tenants must be isolated");

  const { data: stranger } = await supabase
    .from("agents")
    .select("id")
    .eq("wa_id", STRANGER)
    .maybeSingle();
  assert(!stranger, "Stranger number must not be an agent");

  const { data: taken } = await supabase
    .from("agents")
    .select("wa_id, tenants!inner(slug)")
    .eq("wa_id", SHUAYB);
  assert(taken.length === 1, "Shuayb wa_id must be unique");

  console.log("db: ok");
  return { sterlingId: shuayb.tenant_id, ubahId: ubah.tenant_id };
}

async function runLeadIsolation(ids) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count: sterlingLeads, error: sErr } = await supabase
    .from("jarvis_leads")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ids.sterlingId)
    .eq("wa_id", UBAH);
  if (sErr && !/does not exist|schema cache/i.test(sErr.message)) throw new Error(sErr.message);

  const { count: ubahSeesShuayb, error: uErr } = await supabase
    .from("jarvis_leads")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ids.ubahId)
    .eq("wa_id", SHUAYB);
  if (uErr && !/does not exist|schema cache/i.test(uErr.message)) throw new Error(uErr.message);

  console.log(
    `db-leads: ubah-as-sterling-lead=${sterlingLeads ?? "n/a"} shuayb-as-ubah-lead=${ubahSeesShuayb ?? "n/a"}`
  );
}

async function main() {
  runGateTests();
  const ids = await runDbTests();
  await runLeadIsolation(ids);
  console.log("az isolation: all checks passed");
}

main().catch((error) => {
  console.error("az isolation FAILED:", error.message);
  process.exit(1);
});

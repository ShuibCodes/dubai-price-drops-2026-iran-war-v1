import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

const PHONE_NUMBER_ID = "111000111000111";
const WABA_ID = "999888777666555";
const TENANT_NAME = "Sterling Boulevard Dev";
const DEFAULT_AGENT_WA_ID = "971586689688";
const DEFAULT_AGENT_NAME = "Alex";

function normalizeWaId(value) {
  return String(value || "").replace(/\D/g, "");
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const agentWaId = normalizeWaId(process.env.SEED_AGENT_WA_ID || DEFAULT_AGENT_WA_ID);
  const agentName = process.env.SEED_AGENT_NAME || DEFAULT_AGENT_NAME;

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingTenant, error: tenantLookupError } = await supabase
    .from("tenants")
    .select("id")
    .eq("phone_number_id", PHONE_NUMBER_ID)
    .maybeSingle();

  if (tenantLookupError) {
    console.error("Tenant lookup failed:", tenantLookupError.message);
    process.exit(1);
  }

  let tenantId = existingTenant?.id;

  if (!tenantId) {
    const { data: insertedTenant, error: tenantInsertError } = await supabase
      .from("tenants")
      .insert({
        name: TENANT_NAME,
        waba_id: WABA_ID,
        phone_number_id: PHONE_NUMBER_ID,
      })
      .select("id")
      .single();

    if (tenantInsertError) {
      console.error("Tenant insert failed:", tenantInsertError.message);
      process.exit(1);
    }

    tenantId = insertedTenant.id;
    console.log("Seeded tenant:", tenantId);
  } else {
    const { error: tenantUpdateError } = await supabase
      .from("tenants")
      .update({
        name: TENANT_NAME,
        waba_id: WABA_ID,
      })
      .eq("id", tenantId);

    if (tenantUpdateError) {
      console.error("Tenant update failed:", tenantUpdateError.message);
      process.exit(1);
    }

    console.log("Updated tenant:", tenantId);
  }

  const { data: existingAgent, error: agentLookupError } = await supabase
    .from("agents")
    .select("id")
    .eq("wa_id", agentWaId)
    .maybeSingle();

  if (agentLookupError) {
    console.error("Agent lookup failed:", agentLookupError.message);
    process.exit(1);
  }

  if (existingAgent?.id) {
    const { error: agentUpdateError } = await supabase
      .from("agents")
      .update({
        tenant_id: tenantId,
        name: agentName,
        role: "agent",
      })
      .eq("id", existingAgent.id);

    if (agentUpdateError) {
      console.error("Agent update failed:", agentUpdateError.message);
      process.exit(1);
    }

    console.log("Updated agent:", existingAgent.id, `(wa_id=${agentWaId})`);
  } else {
    const { data: insertedAgent, error: agentInsertError } = await supabase
      .from("agents")
      .insert({
        tenant_id: tenantId,
        wa_id: agentWaId,
        name: agentName,
        role: "agent",
      })
      .select("id")
      .single();

    if (agentInsertError) {
      console.error("Agent insert failed:", agentInsertError.message);
      process.exit(1);
    }

    console.log("Seeded agent:", insertedAgent.id, `(wa_id=${agentWaId})`);
  }

  console.log("Seed complete.");
  console.log(`phone_number_id=${PHONE_NUMBER_ID}`);
  console.log(`agent_wa_id=${agentWaId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

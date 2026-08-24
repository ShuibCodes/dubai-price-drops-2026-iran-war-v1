import { createClient } from "@supabase/supabase-js";
import { hashPassword } from "../src/lib/copilot/password.js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const tenantName = String(process.env.CLIENT_NAME || "").trim();
  const tenantSlug = slugify(process.env.CLIENT_SLUG || tenantName);
  const agentName = String(process.env.AGENT_NAME || "").trim();
  const username = String(process.env.AGENT_USERNAME || "").trim().toLowerCase();
  const password = String(process.env.AGENT_PASSWORD || "");
  const waId = digits(process.env.AGENT_WA_ID);

  if (!tenantName || !tenantSlug || !agentName || !username || !password || !waId) {
    console.error(`Usage (all required):
  CLIENT_NAME="Intern Brokerage" \\
  CLIENT_SLUG=intern \\
  AGENT_NAME="First Last" \\
  AGENT_USERNAME=intern \\
  AGENT_PASSWORD='…' \\
  AGENT_WA_ID=9715xxxxxxxx \\
  node scripts/onboard-az-client.mjs

AGENT_WA_ID is the personal WhatsApp they will text AZ from (digits, country code, no +).
Leave onboarded_at null so they still hit Connect WhatsApp on /copilot/{slug}/join.`);
    process.exit(1);
  }

  if (!/^[a-z0-9-]+$/.test(tenantSlug)) {
    console.error(`Bad slug: ${tenantSlug}`);
    process.exit(1);
  }
  if (waId.length < 10) {
    console.error("AGENT_WA_ID looks too short.");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: waTaken, error: waErr } = await supabase
    .from("agents")
    .select("id, name, tenant_id")
    .eq("wa_id", waId)
    .maybeSingle();
  if (waErr) throw new Error(waErr.message);
  if (waTaken) {
    console.error(`wa_id ${waId} already belongs to agent ${waTaken.id} (${waTaken.name}).`);
    process.exit(1);
  }

  let tenant;
  const { data: existingTenant, error: tenantLookupError } = await supabase
    .from("tenants")
    .select("id, slug, name")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (tenantLookupError) throw new Error(tenantLookupError.message);

  if (existingTenant) {
    tenant = existingTenant;
    console.log(`Using existing tenant ${tenant.slug} (${tenant.id})`);
  } else {
    const { data: inserted, error } = await supabase
      .from("tenants")
      .insert({ name: tenantName, slug: tenantSlug })
      .select("id, slug, name")
      .single();
    if (error) throw new Error(`Tenant insert failed: ${error.message}`);
    tenant = inserted;
    console.log(`Created tenant ${tenant.slug} (${tenant.id})`);
  }

  const { data: existingUser, error: userErr } = await supabase
    .from("agents")
    .select("id, tenant_id, username")
    .ilike("username", username.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (userErr) throw new Error(userErr.message);
  if (existingUser) {
    console.error(`Username "${username}" already exists (${existingUser.id}).`);
    process.exit(1);
  }

  const { data: agent, error: insertErr } = await supabase
    .from("agents")
    .insert({
      tenant_id: tenant.id,
      name: agentName,
      username,
      password_hash: hashPassword(password),
      role: "admin",
      wa_id: waId,
    })
    .select("id, username, wa_id")
    .single();
  if (insertErr) throw new Error(`Agent insert failed: ${insertErr.message}`);

  console.log("Onboarded.");
  console.log(`tenant=${tenant.slug}`);
  console.log(`username=${agent.username}`);
  console.log(`wa_id=${agent.wa_id}`);
  console.log(`console=/copilot/${tenant.slug}/join`);
  console.log("They text the SAME AZ number. Inbox is this tenant only.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

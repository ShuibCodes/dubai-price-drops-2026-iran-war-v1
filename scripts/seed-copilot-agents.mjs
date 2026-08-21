import { createClient } from "@supabase/supabase-js";
import { hashPassword } from "../src/lib/copilot/password.js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

function loadRoster() {
  const raw = process.env.COPILOT_USERS_JSON?.trim();
  if (raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("COPILOT_USERS_JSON is not valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("COPILOT_USERS_JSON must be a non-empty array");
    }
    const users = parsed
      .map((entry) => {
        const username = String(entry?.username ?? "").trim();
        const password = String(entry?.password ?? "");
        const tenantSlug = String(entry?.tenantSlug ?? "").trim();
        if (!username || !password || !tenantSlug) return null;
        return { username, password, tenantSlug };
      })
      .filter(Boolean);
    if (!users.length) {
      throw new Error("COPILOT_USERS_JSON has no valid users");
    }
    return users;
  }

  const username = process.env.COPILOT_USERNAME?.trim();
  const password = process.env.COPILOT_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "Set COPILOT_USERS_JSON or COPILOT_USERNAME/COPILOT_PASSWORD before seeding."
    );
  }
  const tenantSlug =
    String(process.env.COPILOT_HOME_TENANT || "1416").trim() || "1416";
  return [{ username, password, tenantSlug }];
}

async function findAgentByUsername(supabase, username) {
  const { data, error } = await supabase
    .from("agents")
    .select("id, tenant_id, username, wa_id, role")
    .ilike("username", username.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (error) throw new Error(`Agent lookup failed: ${error.message}`);
  return data || null;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const roster = loadRoster();
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const user of roster) {
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, slug")
      .eq("slug", user.tenantSlug)
      .maybeSingle();
    if (tenantError) throw new Error(`Tenant lookup failed: ${tenantError.message}`);
    if (!tenant) {
      throw new Error(`No tenant with slug "${user.tenantSlug}" for username "${user.username}".`);
    }

    const existing = await findAgentByUsername(supabase, user.username);
    const passwordHash = hashPassword(user.password);

    if (existing) {
      if (existing.tenant_id !== tenant.id) {
        throw new Error(
          `Username "${user.username}" already belongs to another tenant.`
        );
      }
      const { error: updateError } = await supabase
        .from("agents")
        .update({
          username: user.username,
          password_hash: passwordHash,
          role: "admin",
          name: existing.name || user.username,
        })
        .eq("id", existing.id);
      if (updateError) throw new Error(`Agent update failed: ${updateError.message}`);
      console.log(
        `Updated admin ${user.username} on ${user.tenantSlug} (${existing.id}) wa_id=${existing.wa_id || "null"}`
      );
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("agents")
      .insert({
        tenant_id: tenant.id,
        username: user.username,
        password_hash: passwordHash,
        role: "admin",
        name: user.username,
        wa_id: null,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(`Agent insert failed: ${insertError.message}`);
    console.log(
      `Seeded admin ${user.username} on ${user.tenantSlug} (${inserted.id}) wa_id=null`
    );
  }

  const slugs = [...new Set(roster.map((u) => u.tenantSlug))];
  const { data: tenants, error: tenantListError } = await supabase
    .from("tenants")
    .select("id, slug")
    .in("slug", slugs);
  if (tenantListError) throw new Error(`Tenant list failed: ${tenantListError.message}`);

  for (const tenant of tenants || []) {
    const { count, error } = await supabase
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("role", "admin");
    if (error) throw new Error(`Admin check failed: ${error.message}`);
    if (!count) {
      throw new Error(`Tenant ${tenant.slug} still has no admin after seed.`);
    }
  }

  console.log("Copilot agent roster seed complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

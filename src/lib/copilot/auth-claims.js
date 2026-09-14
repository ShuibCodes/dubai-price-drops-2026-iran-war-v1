// app_metadata is the only metadata bucket a signed-in user cannot write to,
// which is why tenant scoping lives there and not in user_metadata. Every write
// below goes through the service-role admin API — never from the browser.

const AGENT_AUTH_COLS =
  "id, tenant_id, role, email, auth_user_id, tenants!inner(id, slug)";

function likeEscape(value) {
  return value.replace(/[%_\\]/g, "\\$&");
}

export async function findAgentByEmail(admin, email) {
  const address = String(email || "").trim();
  if (!address) return null;
  const { data, error } = await admin
    .from("agents")
    .select(AGENT_AUTH_COLS)
    .ilike("email", likeEscape(address))
    .maybeSingle();
  if (error) throw new Error(`Agent lookup failed: ${error.message}`);
  return data || null;
}

export function buildAgentClaims(agent, tenantSlug) {
  return {
    agent_id: agent.id,
    tenant_id: agent.tenant_id,
    tenant_slug: tenantSlug,
    role: agent.role === "admin" ? "admin" : "agent",
  };
}

export async function linkAgentToAuthUser(admin, agentId, authUserId) {
  const { data, error } = await admin
    .from("agents")
    .update({ auth_user_id: authUserId })
    .eq("id", agentId)
    .is("auth_user_id", null)
    .select("id");
  if (error) throw new Error(`Auth link failed: ${error.message}`);
  // Lost race with a concurrent sign-in; the caller re-reads before trusting it.
  return data?.length === 1;
}

export async function syncAgentClaims(admin, authUserId, agent, tenantSlug) {
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    app_metadata: buildAgentClaims(agent, tenantSlug),
  });
  if (error) throw new Error(`Claim sync failed: ${error.message}`);
}

/**
 * Middleware reads this to gate tenant paths without a database call. Absent
 * when a JWT predates its claims — treated as unknown, never as permission.
 */
export function tenantSlugFromClaims(user) {
  const slug = user?.app_metadata?.tenant_slug;
  return typeof slug === "string" && slug.trim() ? slug.trim() : null;
}

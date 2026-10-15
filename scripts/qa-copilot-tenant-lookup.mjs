/**
 * Copilot session and login lookups without an agents/tenants embed.
 * No Supabase and no production login.
 *
 * node scripts/qa-copilot-tenant-lookup.mjs
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
register("./qa-copilot-tenant-lookup-stub.mjs", import.meta.url);

process.env.COPILOT_SESSION_SECRET = "qa-copilot-tenant-lookup";
for (const key of [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_DB_PASSWORD",
]) {
  delete process.env[key];
}

const { createCopilotTenantDb } = await import("./qa-copilot-tenant-lookup-stub.mjs");
const { getSession } = await import("../src/lib/copilot/session.js");
const { COPILOT_SESSION_COOKIE, createCopilotSessionToken } = await import(
  "../src/lib/copilot-auth.js"
);
const { findAgentByEmail } = await import("../src/lib/copilot/auth-claims.js");
const { hashPassword } = await import("../src/lib/copilot/password.js");
const { POST } = await import("../src/app/api/copilot/auth/route.js");

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const SLUG = "workspace";
const PASSWORD = "local-password";
const PASSWORD_HASH = hashPassword(PASSWORD);

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function useDb({ agents = [], tenants = [], agentError = null, tenantError = null } = {}) {
  const db = createCopilotTenantDb();
  db.rows = { agents, tenants };
  db.agentError = agentError;
  db.tenantError = tenantError;
  globalThis.__copilotTenantDb = db;
  return db;
}

function agentRow(overrides = {}) {
  return {
    id: AGENT,
    tenant_id: TENANT,
    username: "omar",
    role: "admin",
    wa_id: "971500001111",
    email: "omar@example.test",
    auth_user_id: "auth-omar",
    password_hash: PASSWORD_HASH,
    ...overrides,
  };
}

function tenantRow(overrides = {}) {
  return { id: TENANT, slug: SLUG, ...overrides };
}

function sessionSource(token) {
  return {
    cookies: {
      get(name) {
        return name === COPILOT_SESSION_COOKIE ? { value: token } : undefined;
      },
    },
  };
}

function sessionToken() {
  return createCopilotSessionToken({
    agentId: AGENT,
    tenantId: TENANT,
    tenantSlug: SLUG,
  });
}

function loginRequest(body) {
  return {
    json: async () => body,
    cookies: { getAll: () => [] },
  };
}

console.log("\nSESSION");
{
  const db = useDb({ agents: [agentRow()], tenants: [tenantRow()] });
  const session = await getSession(sessionSource(sessionToken()));
  check("session resolves when an embed would be ambiguous", session?.agentId === AGENT);
  check("session tenant comes from the tenant row", session?.tenantId === TENANT && session?.tenantSlug === SLUG);
  check("session keeps the admin role and phone", session?.role === "admin" && session?.waPhone === "+971500001111");
  check(
    "session reads the agent, then that tenant",
    db.calls.length === 2 &&
      db.calls[0].table === "agents" &&
      !String(db.calls[0].columns).includes("tenants") &&
      db.calls[1].table === "tenants" &&
      db.calls[1].filters.some((filter) => filter.column === "id" && filter.value === TENANT)
  );
}

{
  const db = useDb({ agents: [], tenants: [tenantRow()] });
  const session = await getSession(sessionSource(sessionToken()));
  check("missing agent is no session", session === null);
  check("missing agent does not query tenants", db.calls.length === 1 && db.calls[0].table === "agents");
}

{
  const db = useDb({ agents: [agentRow()], tenants: [] });
  const session = await getSession(sessionSource(sessionToken()));
  check("missing tenant is no session", session === null);
  check("missing tenant was queried by the agent tenant_id", db.calls[1]?.table === "tenants");
}

{
  useDb({ agentError: "agents down" });
  let message = "";
  try {
    await getSession(sessionSource(sessionToken()));
  } catch (error) {
    message = error.message;
  }
  check(
    "agent query errors still fail the session lookup",
    message === "Agent session lookup failed: agents down"
  );
}

console.log("\nUSERNAME LOGIN");
{
  const db = useDb({ agents: [agentRow()], tenants: [tenantRow()] });
  const response = await POST(loginRequest({ username: "Omar", password: PASSWORD }));
  const body = await response.json();
  check("username login resolves the tenant", response.status === 200 && body.tenantSlug === SLUG);
  check(
    "username login reads agents by username, then that tenant",
    db.calls[0]?.table === "agents" &&
      db.calls[0].filters.some((filter) => filter.op === "ilike" && filter.value === "Omar") &&
      !String(db.calls[0].columns).includes("tenants") &&
      db.calls[1]?.table === "tenants" &&
      db.calls[1].filters.some((filter) => filter.value === TENANT)
  );
}

{
  process.env.COPILOT_AUTH_JSON_FALLBACK = "0";
  useDb({ agents: [agentRow()], tenants: [] });
  const response = await POST(loginRequest({ username: "omar", password: PASSWORD }));
  const body = await response.json();
  delete process.env.COPILOT_AUTH_JSON_FALLBACK;
  check("username login with no tenant stays a failed login", response.status === 401 && body.ok === false);
}

console.log("\nEMAIL CLAIMS");
{
  const db = useDb({ agents: [agentRow()], tenants: [tenantRow()] });
  const agent = await findAgentByEmail(db, "Omar@Example.test");
  check("email lookup resolves the tenant", agent?.tenants?.slug === SLUG && agent?.tenant_id === TENANT);
  check(
    "email lookup keeps the agent fields",
    agent?.id === AGENT &&
      agent?.email === "omar@example.test" &&
      agent?.auth_user_id === "auth-omar" &&
      agent?.role === "admin"
  );
  check(
    "email lookup reads agents by email, then that tenant",
    db.calls[0]?.table === "agents" &&
      db.calls[0].filters.some((filter) => filter.op === "ilike" && filter.value === "Omar@Example.test") &&
      !String(db.calls[0].columns).includes("tenants") &&
      db.calls[1]?.table === "tenants"
  );
}

{
  const agent = await findAgentByEmail(
    useDb({ agents: [], tenants: [tenantRow()] }),
    "omar@example.test"
  );
  check("email lookup with no agent returns null", agent === null);
}

{
  const agent = await findAgentByEmail(
    useDb({ agents: [agentRow()], tenants: [] }),
    "omar@example.test"
  );
  check("email lookup with no tenant returns null", agent === null);
}

console.log("\nLIVE EMBEDS");
{
  const files = [
    "src/lib/copilot/session.js",
    "src/app/api/copilot/auth/route.js",
    "src/lib/copilot/auth-claims.js",
    "src/app/api/cron/morning-brief/route.js",
    "scripts/send-morning-briefs.mjs",
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    check(`${file} does not embed tenants`, !text.includes("tenants!") && !text.includes("tenants("));
  }
}

if (failures) {
  console.error(`\n${failures} copilot tenant lookup check(s) failed.`);
  process.exit(1);
}
console.log("\nAll copilot tenant lookup checks passed.");

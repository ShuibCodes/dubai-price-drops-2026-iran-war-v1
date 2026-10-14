/**
 * Jarvis sender lookup without an agents/tenants embed.
 * No Supabase and no production send.
 *
 * node scripts/qa-jarvis-resolve-sender.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
register("./qa-jarvis-resolve-sender-stub.mjs", import.meta.url);

for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "SUPABASE_DB_PASSWORD"]) {
  delete process.env[key];
}

const { createResolveSenderDb } = await import("./qa-jarvis-resolve-sender-stub.mjs");
const { resolveJarvisSender } = await import("../src/lib/jarvis/resolve-sender.js");

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";
const AGENT = "22222222-2222-4222-8222-222222222222";
const OTHER_AGENT = "44444444-4444-4444-8444-444444444444";

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function useDb(lookup) {
  globalThis.__resolveSenderDb = createResolveSenderDb(lookup);
  return globalThis.__resolveSenderDb;
}

console.log("\nKNOWN SENDER");
{
  const db = useDb((table, column, value) => {
    if (table === "agents" && column === "wa_id" && value === "971500009991") {
      return {
        data: {
          id: AGENT,
          name: "Omar Hassan",
          username: "omar",
          role: "admin",
          wa_id: "971500009991",
          tenant_id: TENANT,
        },
        error: null,
      };
    }
    if (table === "tenants" && column === "id" && value === TENANT) {
      return {
        data: { id: TENANT, name: "Workspace", slug: "workspace" },
        error: null,
      };
    }
    return {
      data: {
        id: OTHER_AGENT,
        name: "Other",
        username: "other",
        role: "agent",
        wa_id: "971500000000",
        tenant_id: OTHER_TENANT,
      },
      error: null,
    };
  });
  const sender = await resolveJarvisSender("whatsapp:+971500009991");
  check("known sender resolves the matching agent", sender?.agentId === AGENT);
  check("known sender resolves the matching tenant", sender?.tenantId === TENANT);
  check("known sender keeps the tenant slug", sender?.tenantSlug === "workspace");
  check("known sender keeps the agent name", sender?.agentName === "Omar Hassan");
  check("known sender does not return another agent", sender?.agentId !== OTHER_AGENT);
  check(
    "known sender reads the agent, then that tenant",
    db.calls.length === 2 &&
      db.calls[0].table === "agents" &&
      db.calls[0].value === "971500009991" &&
      db.calls[1].table === "tenants" &&
      db.calls[1].value === TENANT
  );
  check(
    "known sender does not embed tenants",
    db.calls.every((call) => !String(call.columns).includes("tenants"))
  );
}

console.log("\nUNKNOWN SENDER");
{
  useDb(() => ({ data: null, error: null }));
  const sender = await resolveJarvisSender("whatsapp:+971500008888");
  check("unknown sender returns null", sender === null);
  const blank = await resolveJarvisSender("whatsapp:+");
  check("blank sender returns null without a lookup", blank === null && globalThis.__resolveSenderDb.calls.length === 1);
}

console.log("\nDATABASE ERROR");
{
  useDb((table) => {
    if (table === "agents") {
      return { data: null, error: { message: "connection refused" } };
    }
    return {
      data: { id: OTHER_AGENT, tenant_id: OTHER_TENANT, name: "Other", wa_id: "971500000000" },
      error: null,
    };
  });
  let thrown = null;
  try {
    await resolveJarvisSender("971500009991");
  } catch (error) {
    thrown = error;
  }
  check(
    "agent lookup error throws",
    thrown instanceof Error && thrown.message === "Jarvis sender lookup failed: connection refused"
  );
  useDb((table) => {
    if (table === "agents") {
      return {
        data: {
          id: AGENT,
          name: "Omar Hassan",
          username: "omar",
          role: "agent",
          wa_id: "971500009991",
          tenant_id: TENANT,
        },
        error: null,
      };
    }
    return { data: null, error: { message: "tenant read failed" } };
  });
  thrown = null;
  try {
    await resolveJarvisSender("971500009991");
  } catch (error) {
    thrown = error;
  }
  check(
    "tenant lookup error throws",
    thrown instanceof Error && thrown.message === "Jarvis sender lookup failed: tenant read failed"
  );
}

console.log("\nAMBIGUOUS RELATIONSHIP");
{
  const db = useDb((table, column, value) => {
    if (table === "agents" && column === "wa_id" && value === "971500009991") {
      return {
        data: {
          id: AGENT,
          name: "",
          username: "omar",
          role: "agent",
          wa_id: "971500009991",
          tenant_id: TENANT,
        },
        error: null,
      };
    }
    if (table === "tenants" && column === "id" && value === TENANT) {
      return { data: { id: TENANT, name: "", slug: "workspace" }, error: null };
    }
    return { data: null, error: null };
  });
  const sender = await resolveJarvisSender("971500009991");
  check("split lookup still resolves when an embed would be ambiguous", sender?.agentId === AGENT);
  check("empty agent name falls back to the username", sender?.agentName === "omar");
  check("empty tenant name falls back to the slug", sender?.tenantName === "workspace");
  check("embed select is not issued", db.calls.every((call) => !String(call.columns).includes("tenants!")));
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nAll Jarvis sender lookup checks passed.");

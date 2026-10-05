/**
 * Local stand-in for Copilot session and login lookups.
 * An embed of tenants from agents reproduces the production ambiguity.
 * Separate agent and tenant lookups do not.
 */
const SELF = import.meta.url;
const EMBED_ERROR =
  "Could not embed because more than one relationship was found for 'agents' and 'tenants'";

export class NextResponse extends Response {
  static json(body, init = {}) {
    const response = new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    });
    response.cookies = { set() {} };
    return response;
  }
}

export async function resolve(specifier, context, nextResolve) {
  const bare = String(specifier || "").split("?")[0];
  if (
    bare === "@/lib/supabase/server" ||
    bare.endsWith("/src/lib/supabase/server.js") ||
    bare === "next/server"
  ) {
    return { url: SELF, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function getSupabaseServerClient() {
  return globalThis.__copilotTenantDb ?? null;
}

function selectChain(table, columns) {
  const filters = [];
  const chain = {
    eq(column, value) {
      filters.push({ op: "eq", column, value });
      return chain;
    },
    ilike(column, value) {
      filters.push({ op: "ilike", column, value });
      return chain;
    },
    async maybeSingle() {
      const db = globalThis.__copilotTenantDb;
      db.calls.push({
        table,
        columns,
        filters: filters.map((filter) => ({ ...filter })),
      });
      if (String(columns).includes("tenants")) {
        return { data: null, error: { message: EMBED_ERROR } };
      }
      return db.lookup({ table, filters });
    },
  };
  return chain;
}

export function createCopilotTenantDb() {
  const db = {
    calls: [],
    rows: { agents: [], tenants: [] },
    agentError: null,
    tenantError: null,
    lookup({ table, filters }) {
      if (table === "agents" && this.agentError) {
        return { data: null, error: { message: this.agentError } };
      }
      if (table === "tenants" && this.tenantError) {
        return { data: null, error: { message: this.tenantError } };
      }
      const matched = (this.rows[table] || []).filter((row) =>
        filters.every((filter) => {
          const left = row[filter.column];
          if (filter.op === "ilike") {
            return String(left ?? "").toLowerCase() === String(filter.value).toLowerCase();
          }
          return left === filter.value;
        })
      );
      if (matched.length > 1) {
        return { data: null, error: { message: "multiple rows" } };
      }
      return { data: matched[0] ? { ...matched[0] } : null, error: null };
    },
    from(table) {
      return {
        select(columns) {
          return selectChain(table, columns);
        },
        update(payload) {
          return {
            eq(column, value) {
              db.calls.push({ table, op: "update", column, value, payload });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
  return db;
}

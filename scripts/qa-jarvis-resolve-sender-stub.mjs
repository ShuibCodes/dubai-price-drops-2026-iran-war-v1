/**
 * Local stand-in for resolveJarvisSender.
 * An embed of tenants from agents reproduces the production ambiguity.
 * Separate agent and tenant lookups do not.
 */
const SELF = import.meta.url;
const EMBED_ERROR =
  "Could not embed because more than one relationship was found for 'agents' and 'tenants'";

export async function resolve(specifier, context, nextResolve) {
  const bare = String(specifier || "").split("?")[0];
  if (
    bare === "@/lib/supabase/server" ||
    bare.endsWith("/src/lib/supabase/server.js")
  ) {
    return { url: SELF, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function getSupabaseServerClient() {
  return globalThis.__resolveSenderDb ?? null;
}

export function normalizeWaId(value) {
  return String(value || "").replace(/\D/g, "");
}

function chain(table, columns) {
  return {
    eq(column, value) {
      return {
        async maybeSingle() {
          const db = globalThis.__resolveSenderDb;
          db.calls.push({ table, columns, column, value });
          if (String(columns).includes("tenants")) {
            return { data: null, error: { message: EMBED_ERROR } };
          }
          return db.lookup(table, column, value);
        },
      };
    },
  };
}

export function createResolveSenderDb(lookup) {
  return {
    calls: [],
    lookup,
    from(table) {
      return {
        select(columns) {
          return chain(table, columns);
        },
      };
    },
  };
}

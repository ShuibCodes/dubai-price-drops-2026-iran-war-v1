/**
 * Test-only stand-in for the pending confirmation QA.
 * Redirects the Jarvis supabase client and relay dial so a local "yes"
 * can complete without a database, a network call, or a real WhatsApp send.
 *
 * Loaded as a Node module hook by qa-jarvis-whatsapp-style.mjs.
 */
const SELF = import.meta.url;

export async function resolve(specifier, context, nextResolve) {
  const bare = String(specifier || "").split("?")[0];
  if (
    bare === "@/lib/supabase/server" ||
    bare.endsWith("/lib/supabase/server") ||
    bare.endsWith("/lib/supabase/server.js") ||
    bare === "@/lib/vapi/client" ||
    bare.endsWith("/lib/vapi/client") ||
    bare.endsWith("/lib/vapi/client.js")
  ) {
    return { url: SELF, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export const MESSAGES_TABLE = "whatsapp-messages";

export function normalizeWaId(value) {
  return String(value || "").replace(/\D/g, "");
}

export function getSupabaseServerClient() {
  return globalThis.__azConfirmDb || null;
}

export async function startRelayCall(args) {
  const dials = (globalThis.__azConfirmDials ||= []);
  dials.push({ ...args });
  return { callId: "local-no-network" };
}

function memoryQuery(rows) {
  const state = { op: "select", payload: null, filters: [] };
  const api = {
    select() {
      return api;
    },
    insert(row) {
      state.op = "insert";
      state.payload = { id: `row-${rows.length + 1}`, ...row };
      return api;
    },
    upsert(row) {
      state.op = "upsert";
      state.payload = { ...row };
      return api;
    },
    update(row) {
      state.op = "update";
      state.payload = { ...row };
      return api;
    },
    delete() {
      state.op = "delete";
      return api;
    },
    eq(column, value) {
      state.filters.push([column, value]);
      return api;
    },
    or() {
      return api;
    },
    not() {
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    maybeSingle() {
      return Promise.resolve(finish(false));
    },
    single() {
      return Promise.resolve(finish(true));
    },
    then(resolve, reject) {
      return Promise.resolve(finish(false)).then(resolve, reject);
    },
  };

  function matches(row) {
    return state.filters.every(([column, value]) => row[column] === value);
  }

  function finish(single) {
    if (state.op === "insert") {
      rows.push(state.payload);
      return { data: state.payload, error: null };
    }
    if (state.op === "upsert") {
      const key = state.payload.sender_phone;
      const index = rows.findIndex((row) => row.sender_phone === key);
      if (index >= 0) rows[index] = { ...rows[index], ...state.payload };
      else rows.push({ id: `row-${rows.length + 1}`, ...state.payload });
      return { data: index >= 0 ? rows[index] : rows[rows.length - 1], error: null };
    }
    if (state.op === "update") {
      const found = rows.filter(matches);
      for (const row of found) Object.assign(row, state.payload);
      const data = single ? found[0] || null : found[0] || null;
      if (single && found.length !== 1) {
        return { data: null, error: { message: "expected one row" } };
      }
      return { data, error: null };
    }
    if (state.op === "delete") {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index])) rows.splice(index, 1);
      }
      return { data: null, error: null };
    }
    const found = rows.filter(matches);
    if (single && found.length !== 1) {
      return { data: null, error: { message: `expected one row, got ${found.length}` } };
    }
    return { data: found[0] || null, error: null };
  }

  return api;
}

export function installConfirmMemory({ tenantId, agentId, senderPhone, pendingRelay, pendingContact }) {
  const tables = {
    agents: [
      {
        id: agentId,
        name: "Alex",
        username: "alex",
        role: "agent",
        wa_id: senderPhone,
        tenant_id: tenantId,
        tenants: { id: tenantId, name: "local", slug: "local" },
      },
    ],
    jarvis_pending_relays: pendingRelay ? [{ ...pendingRelay }] : [],
    jarvis_pending_contacts: pendingContact ? [{ ...pendingContact }] : [],
    jarvis_leads: [],
    relay_calls: [],
  };
  globalThis.__azConfirmDials = [];
  globalThis.__azConfirmDb = {
    from(name) {
      const rows = (tables[name] ||= []);
      return memoryQuery(rows);
    },
    tables,
  };
  return globalThis.__azConfirmDb;
}

export function confirmDials() {
  return globalThis.__azConfirmDials || [];
}

export function clearConfirmMemory() {
  globalThis.__azConfirmDb = null;
  globalThis.__azConfirmDials = [];
}

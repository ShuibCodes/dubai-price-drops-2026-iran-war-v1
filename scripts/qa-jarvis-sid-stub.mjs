/**
 * Local stand-ins for the Jarvis MessageSid route test.
 * No Supabase, Twilio, or model network calls.
 */
import { MESSAGES_TABLE, normalizeWaId } from "../src/lib/supabase/server.js";

const SELF = import.meta.url;

const REDIRECTS = new Set([
  "@/lib/supabase/server",
  "@/lib/jarvis/engine",
  "@/lib/kb/engine",
  "@/lib/whatsapp/twilio-send",
  "@vercel/functions",
]);

export async function resolve(specifier, context, nextResolve) {
  const bare = String(specifier || "").split("?")[0];
  if (
    REDIRECTS.has(bare) ||
    bare.endsWith("/src/lib/jarvis/engine.js") ||
    bare.endsWith("/src/lib/kb/engine.js") ||
    bare.endsWith("/src/lib/whatsapp/twilio-send.js") ||
    bare.endsWith("/node_modules/@vercel/functions/index.js")
  ) {
    return { url: SELF, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export { MESSAGES_TABLE, normalizeWaId };

export function getSupabaseServerClient() {
  return globalThis.__jarvisSidDb || null;
}

export function defaultKbState() {
  return { messages: [] };
}

export async function runKbTurn() {
  globalThis.__kbSidTurns = (globalThis.__kbSidTurns || 0) + 1;
  return {
    text: "You're not registered on AgentZero yet. Ask your admin to add your WhatsApp number.",
    nextState: { messages: [] },
  };
}

export async function runJarvisTurn() {
  const run = globalThis.__jarvisSidRun;
  if (!run) return { text: "Saved answer" };
  return run();
}

export function twilioRestConfigured() {
  return globalThis.__jarvisSidRest === true;
}

export function plainJarvisWhatsAppText(text) {
  return String(text || "").trim();
}

export function truncateWhatsAppBody(text) {
  return String(text || "").trim();
}

export async function sendWhatsAppText({ body }) {
  if (globalThis.__jarvisSidFailSend) {
    globalThis.__jarvisSidFailSend = false;
    throw new Error("twilio 500");
  }
  const sends = (globalThis.__jarvisSidSends ||= []);
  sends.push(String(body || ""));
}

export function waitUntil(task) {
  const waits = (globalThis.__jarvisSidWaits ||= []);
  waits.push(task);
}

export function createSidStore() {
  const messages = [];
  const locks = new Map();
  let seq = 0;
  let denied = 0;

  function keyOf(args) {
    return `${args.p_tenant_id}|${args.p_agent_id}|${args.p_sender_phone}`;
  }

  function matches(row, filters) {
    return filters.every(([col, value]) => row[col] === value);
  }

  function requireScope(filters) {
    const cols = new Set(filters.map(([col]) => col));
    if (!cols.has("tenant_id") || !cols.has("agent_id") || !cols.has("sender_phone")) {
      throw new Error("query missing conversation scope");
    }
  }

  function chain(exec) {
    const filters = [];
    const api = {
      eq(col, value) {
        filters.push([col, value]);
        return api;
      },
      order(col, opts) {
        exec.orders.push([col, opts?.ascending !== false]);
        return api;
      },
      limit(n) {
        exec.limit = n;
        return api;
      },
      maybeSingle: () => exec.run("maybe", filters),
      single: () => exec.run("single", filters),
      then(resolve, reject) {
        return exec.run("many", filters).then(resolve, reject);
      },
    };
    return api;
  }

  const store = {
    messages,
    locks,
    denied: () => denied,
    rpc(name, args) {
      const key = keyOf(args);
      const now = Date.now();
      const existing = locks.get(key);
      if (name === "acquire_jarvis_conversation_lock") {
        if (!existing || existing.lockedUntil < now) {
          locks.set(key, {
            token: args.p_lock_token,
            lockedUntil: now + args.p_lease_seconds * 1000,
          });
          return Promise.resolve({ data: args.p_lock_token, error: null });
        }
        denied += 1;
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "extend_jarvis_conversation_lock") {
        if (!existing || existing.token !== args.p_lock_token || existing.lockedUntil <= now) {
          return Promise.resolve({ data: null, error: null });
        }
        existing.lockedUntil = now + args.p_lease_seconds * 1000;
        return Promise.resolve({ data: args.p_lock_token, error: null });
      }
      if (name === "release_jarvis_conversation_lock") {
        if (existing && existing.token === args.p_lock_token) locks.delete(key);
        return Promise.resolve({
          data: Boolean(existing && existing.token === args.p_lock_token),
          error: null,
        });
      }
      if (name === "insert_jarvis_assistant_if_owner") {
        if (!existing || existing.token !== args.p_lock_token || existing.lockedUntil <= now) {
          return Promise.resolve({ data: null, error: null });
        }
        const found = messages.find(
          (item) =>
            item.role === "assistant" &&
            item.turn_id === args.p_turn_id &&
            item.tenant_id === args.p_tenant_id &&
            item.agent_id === args.p_agent_id &&
            item.sender_phone === args.p_sender_phone
        );
        if (found) return Promise.resolve({ data: found.id, error: null });
        seq += 1;
        const saved = {
          id: `row-${seq}`,
          seq,
          tenant_id: args.p_tenant_id,
          agent_id: args.p_agent_id,
          sender_phone: args.p_sender_phone,
          role: "assistant",
          body: args.p_body,
          message_sid: null,
          turn_id: args.p_turn_id,
          sent_at: null,
          created_at: new Date().toISOString(),
        };
        messages.push(saved);
        return Promise.resolve({ data: saved.id, error: null });
      }
      if (name === "mark_jarvis_assistant_sent_if_owner") {
        if (!existing || existing.token !== args.p_lock_token || existing.lockedUntil <= now) {
          return Promise.resolve({ data: false, error: null });
        }
        const row = messages.find(
          (item) =>
            item.id === args.p_message_id &&
            item.tenant_id === args.p_tenant_id &&
            item.agent_id === args.p_agent_id &&
            item.sender_phone === args.p_sender_phone &&
            item.role === "assistant"
        );
        if (!row || row.sent_at) return Promise.resolve({ data: false, error: null });
        row.sent_at = new Date().toISOString();
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
    from(table) {
      if (table === "agents") {
        const filters = [];
        const api = {
          select() {
            return api;
          },
          eq(col, value) {
            filters.push([col, value]);
            return api;
          },
          maybeSingle() {
            const wa = filters.find(([col]) => col === "wa_id")?.[1];
            if (wa === "971500009991") {
              return Promise.resolve({
                data: {
                  id: "22222222-2222-4222-8222-222222222222",
                  name: "Agent",
                  username: "agent",
                  role: "agent",
                  wa_id: wa,
                  tenant_id: "11111111-1111-4111-8111-111111111111",
                  tenants: { id: "11111111-1111-4111-8111-111111111111", name: "Workspace", slug: "workspace" },
                },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return api;
      }
      if (table === "tenants") {
        const filters = [];
        const api = {
          select() {
            return api;
          },
          eq(col, value) {
            filters.push([col, value]);
            return api;
          },
          maybeSingle() {
            const id = filters.find(([col]) => col === "id")?.[1];
            if (id === "11111111-1111-4111-8111-111111111111") {
              return Promise.resolve({
                data: { id, name: "Workspace", slug: "workspace" },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return api;
      }
      if (table !== "jarvis_conversation_messages") {
        const api = {
          select() {
            return api;
          },
          insert() {
            return api;
          },
          upsert() {
            return api;
          },
          update() {
            return api;
          },
          delete() {
            return api;
          },
          eq() {
            return api;
          },
          order() {
            return api;
          },
          limit() {
            return api;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve, reject) {
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return api;
      }
      return {
        insert(row) {
          return {
            select() {
              return {
                async single() {
                  if (!row.tenant_id || !row.agent_id || !row.sender_phone) {
                    return { data: null, error: { message: "missing scope" } };
                  }
                  const sidClash =
                    row.role === "user" &&
                    row.message_sid &&
                    messages.some(
                      (item) =>
                        item.role === "user" &&
                        item.message_sid === row.message_sid &&
                        item.tenant_id === row.tenant_id &&
                        item.agent_id === row.agent_id &&
                        item.sender_phone === row.sender_phone
                    );
                  if (sidClash) {
                    return { data: null, error: { code: "23505", message: "duplicate" } };
                  }
                  seq += 1;
                  const saved = {
                    ...row,
                    id: `row-${seq}`,
                    seq,
                    sent_at: null,
                    created_at: new Date().toISOString(),
                  };
                  messages.push(saved);
                  return {
                    data: {
                      id: saved.id,
                      turn_id: saved.turn_id,
                      body: saved.body,
                      sent_at: saved.sent_at,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
        select() {
          const exec = {
            orders: [],
            limit: null,
            run(mode, filters) {
              try {
                requireScope(filters);
                let rows = messages.filter((item) => matches(item, filters));
                for (const [col, ascending] of exec.orders) {
                  rows.sort((a, b) => {
                    if (a[col] === b[col]) return 0;
                    if (ascending) return a[col] < b[col] ? -1 : 1;
                    return a[col] > b[col] ? -1 : 1;
                  });
                }
                if (exec.limit != null) rows = rows.slice(0, exec.limit);
                if (mode === "maybe") {
                  if (rows.length > 1) {
                    return Promise.resolve({ data: null, error: { message: "multiple rows" } });
                  }
                  return Promise.resolve({ data: rows[0] || null, error: null });
                }
                return Promise.resolve({ data: rows, error: null });
              } catch (error) {
                return Promise.resolve({ data: null, error: { message: error.message } });
              }
            },
          };
          return chain(exec);
        },
        update(patch) {
          const exec = {
            orders: [],
            limit: null,
            run(_mode, filters) {
              try {
                requireScope(filters);
                const rows = messages.filter((item) => matches(item, filters));
                for (const row of rows) Object.assign(row, patch);
                return Promise.resolve({ data: rows, error: null });
              } catch (error) {
                return Promise.resolve({ data: null, error: { message: error.message } });
              }
            },
          };
          return chain(exec);
        },
      };
    },
  };

  return {
    messages,
    locks,
    denied: store.denied,
    rpc: (name, args) => store.rpc(name, args),
    from: (table) => store.from(table),
  };
}

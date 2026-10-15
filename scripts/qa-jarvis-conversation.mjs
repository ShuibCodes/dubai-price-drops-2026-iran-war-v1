/**
 * Durable Jarvis transcript: ordering, leases, isolation, and fact follow-up.
 * The lease tests share one in-memory database between two clients. There is
 * no process mutex. Nothing is written to Supabase or WhatsApp.
 *
 * node scripts/qa-jarvis-conversation.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadAnthropicKey() {
  try {
    for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq < 1 || line.trim().startsWith("#")) continue;
      if (line.slice(0, eq).trim() !== "ANTHROPIC_API_KEY") continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env.ANTHROPIC_API_KEY = value;
    }
  } catch {
    // The model follow-up is skipped when no key file is available.
  }
  for (const key of [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "VAPI_API_KEY",
  ]) {
    delete process.env[key];
  }
}

loadAnthropicKey();

const {
  withJarvisConversation,
  JARVIS_CONVERSATION_LEASE_SECONDS,
  JARVIS_ROUTE_MAX_DURATION_SECONDS,
} = await import("../src/lib/jarvis/conversation.js");
const { setSenderState, getSenderState } = await import("../src/lib/whatsapp/state-store.js");
const { runJarvisTurn } = await import("../src/lib/jarvis/engine.js");

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "33333333-3333-4333-8333-333333333333";
const A1 = "22222222-2222-4222-8222-222222222222";
const A2 = "44444444-4444-4444-8444-444444444444";

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStore() {
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

  return {
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
        return Promise.resolve({ data: Boolean(existing && existing.token === args.p_lock_token), error: null });
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
      if (table !== "jarvis_conversation_messages") {
        throw new Error(`unexpected table ${table}`);
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
                  const assistantClash =
                    row.role === "assistant" &&
                    messages.some(
                      (item) =>
                        item.role === "assistant" &&
                        item.turn_id === row.turn_id &&
                        item.tenant_id === row.tenant_id &&
                        item.agent_id === row.agent_id &&
                        item.sender_phone === row.sender_phone
                    );
                  if (sidClash || assistantClash) {
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
}

function clientFor(store) {
  return {
    rpc: (name, args) => store.rpc(name, args),
    from: (table) => store.from(table),
  };
}

function texts(store, scope) {
  return store.messages
    .filter(
      (row) =>
        row.tenant_id === scope.tenantId &&
        row.agent_id === scope.agentId &&
        row.sender_phone === scope.senderPhone
    )
    .sort((a, b) => a.seq - b.seq)
    .map((row) => `${row.role}:${row.body}`);
}

console.log("\nSOURCE");
{
  const source = readFileSync(join(ROOT, "src/lib/jarvis/conversation.js"), "utf8");
  check("conversation module has no in-process lock map", !source.includes("new Map"));
  check(
    "conversation module uses the database lease",
    source.includes("acquire_jarvis_conversation_lock") &&
      source.includes("release_jarvis_conversation_lock") &&
      source.includes("insert_jarvis_assistant_if_owner") &&
      source.includes("mark_jarvis_assistant_sent_if_owner") &&
      !source.includes("claim_jarvis_assistant_send_if_owner")
  );
  const deliverFn = source.slice(
    source.indexOf("async function deliverIfOwner"),
    source.indexOf("export async function withJarvisConversation")
  );
  check(
    "sent mark is stored only after deliver returns",
    deliverFn.indexOf("await deliver(") !== -1 &&
      deliverFn.indexOf("await deliver(") < deliverFn.indexOf("markSentIfOwner(")
  );
  const route = readFileSync(join(ROOT, "src/app/api/whatsapp/route.js"), "utf8");
  const jarvisAsync = route.slice(
    route.indexOf("if (useJarvis && twilioRestConfigured()"),
    route.indexOf("if (useJarvis && !twilioRestConfigured()")
  );
  const jarvisBackground = route.slice(
    route.indexOf("async function runJarvisAndReply"),
    route.indexOf("export async function GET")
  );
  check(
    "known Jarvis async path does not cache MessageSid before the turn",
    jarvisAsync.includes("waitUntil(") && !jarvisAsync.includes("markProcessedMessageSid")
  );
  check(
    "known Jarvis background turn does not cache MessageSid",
    !jarvisBackground.includes("markProcessedMessageSid")
  );
  check(
    "unknown sender still caches MessageSid after the KB turn",
    /if \(!useJarvis\) \{[\s\S]*markProcessedMessageSid\(from, messageSid\)/.test(route)
  );
  const senderState = readFileSync(join(ROOT, "src/lib/whatsapp/state-store.js"), "utf8");
  check(
    "obsolete Jarvis transcript helper is gone",
    !senderState.includes("pushConversationTurn") && !route.includes("messages: []")
  );
  check(
    "KB transcript field remains on sender state",
    senderState.includes("messages: normalizeMessages")
  );
  const routeLimit = Number(route.match(/export const maxDuration = (\d+)/)?.[1]);
  check(
    "lease outlives the webhook maxDuration",
    routeLimit === JARVIS_ROUTE_MAX_DURATION_SECONDS &&
      JARVIS_CONVERSATION_LEASE_SECONDS === routeLimit + 60 &&
      JARVIS_CONVERSATION_LEASE_SECONDS === 150
  );
}

console.log("\nSEQUENTIAL");
{
  const store = createStore();
  const scope = { tenantId: T1, agentId: A1, senderPhone: "971500000001" };
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM1",
    userText: "First question",
    pollMs: 5,
    run: async () => "First answer",
  });
  let seen = [];
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM2",
    userText: "Second question",
    pollMs: 5,
    run: async (messages) => {
      seen = messages;
      return "Second answer";
    },
  });
  check(
    "turn 2 sees turn 1",
    JSON.stringify(seen) ===
      JSON.stringify([
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Second question" },
      ])
  );
  check(
    "both turns remain in order",
    JSON.stringify(texts(store, scope)) ===
      JSON.stringify([
        "user:First question",
        "assistant:First answer",
        "user:Second question",
        "assistant:Second answer",
      ])
  );
}

console.log("\nCONCURRENT INSTANCES");
{
  const store = createStore();
  const clientA = clientFor(store);
  const clientB = clientFor(store);
  const scope = { tenantId: T1, agentId: A1, senderPhone: "971500000002" };
  let releaseHold;
  const hold = new Promise((resolve) => {
    releaseHold = resolve;
  });
  let aHolding = false;
  let bStarted = false;
  let bSeen = [];
  const first = withJarvisConversation({
    supabase: clientA,
    ...scope,
    messageSid: "SM-A",
    userText: "Message A",
    pollMs: 10,
    waitMs: 3000,
    run: async () => {
      aHolding = true;
      await hold;
      return "Reply A";
    },
  });
  const started = Date.now();
  while (!aHolding && Date.now() - started < 1000) await sleep(5);
  const second = withJarvisConversation({
    supabase: clientB,
    ...scope,
    messageSid: "SM-B",
    userText: "Message B",
    pollMs: 10,
    waitMs: 3000,
    run: async (messages) => {
      bStarted = true;
      bSeen = messages;
      return "Reply B";
    },
  });
  const other = withJarvisConversation({
    supabase: clientFor(store),
    tenantId: T1,
    agentId: A1,
    senderPhone: "971500000003",
    messageSid: "SM-OTHER",
    userText: "Other sender",
    pollMs: 5,
    run: async () => "Other reply",
  });
  await other;
  const deniedAt = Date.now();
  while (store.denied() < 1 && Date.now() - deniedAt < 1000) await sleep(5);
  check("second instance did not start on the stale snapshot", bStarted === false);
  check("second instance was refused the lease while the first held it", store.denied() >= 1);
  check("clients are separate objects", clientA !== clientB);
  releaseHold();
  await Promise.all([first, second]);
  check(
    "second turn saw the completed first turn",
    JSON.stringify(bSeen) ===
      JSON.stringify([
        { role: "user", content: "Message A" },
        { role: "assistant", content: "Reply A" },
        { role: "user", content: "Message B" },
      ])
  );
  check(
    "both turns remain after the overlap",
    JSON.stringify(texts(store, scope)) ===
      JSON.stringify([
        "user:Message A",
        "assistant:Reply A",
        "user:Message B",
        "assistant:Reply B",
      ])
  );
  check(
    "a different sender was not blocked",
    texts(store, { tenantId: T1, agentId: A1, senderPhone: "971500000003" }).join("|") ===
      "user:Other sender|assistant:Other reply"
  );
  check("leases were released", store.locks.size === 0);
}

console.log("\nRESTART");
{
  const store = createStore();
  const from = "whatsapp:+971500000004";
  setSenderState(from, {
    messages: [{ role: "user", content: "only in memory" }],
  });
  const scope = { tenantId: T1, agentId: A1, senderPhone: "971500000004" };
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-R1",
    userText: "Persisted question",
    pollMs: 5,
    run: async () => "Persisted answer",
  });
  setSenderState(from, { messages: [] });
  check("in-memory transcript was cleared", getSenderState(from).messages.length === 0);
  let seen = [];
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-R2",
    userText: "After restart",
    pollMs: 5,
    run: async (messages) => {
      seen = messages;
      return "Still here";
    },
  });
  check(
    "history survived the cleared memory",
    seen.some((item) => item.content === "Persisted answer") &&
      !seen.some((item) => item.content === "only in memory")
  );
}

console.log("\nISOLATION");
{
  const store = createStore();
  await withJarvisConversation({
    supabase: clientFor(store),
    tenantId: T1,
    agentId: A1,
    senderPhone: "971500000005",
    messageSid: "SM-ISO-A",
    userText: "secret-alpha",
    pollMs: 5,
    run: async () => "alpha-reply",
  });
  await withJarvisConversation({
    supabase: clientFor(store),
    tenantId: T2,
    agentId: A2,
    senderPhone: "971500000006",
    messageSid: "SM-ISO-B",
    userText: "secret-beta",
    pollMs: 5,
    run: async () => "beta-reply",
  });
  await withJarvisConversation({
    supabase: clientFor(store),
    tenantId: T1,
    agentId: A2,
    senderPhone: "971500000005",
    messageSid: "SM-ISO-C",
    userText: "secret-gamma",
    pollMs: 5,
    run: async () => "gamma-reply",
  });
  let seen = [];
  await withJarvisConversation({
    supabase: clientFor(store),
    tenantId: T1,
    agentId: A1,
    senderPhone: "971500000005",
    messageSid: "SM-ISO-A2",
    userText: "again",
    pollMs: 5,
    run: async (messages) => {
      seen = messages.map((item) => item.content);
      return "ok";
    },
  });
  check("same agent sees its own secret", seen.includes("secret-alpha") && seen.includes("alpha-reply"));
  check("other tenant is invisible", !seen.includes("secret-beta") && !seen.includes("beta-reply"));
  check(
    "same tenant other agent is invisible",
    !seen.includes("secret-gamma") && !seen.includes("gamma-reply")
  );
}

console.log("\nFAILURE AND DUPLICATES");
{
  const store = createStore();
  const scope = { tenantId: T1, agentId: A1, senderPhone: "971500000007" };
  let failed = false;
  try {
    await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-FAIL",
      userText: "boom",
      pollMs: 5,
      run: async () => {
        throw new Error("model down");
      },
    });
  } catch (error) {
    failed = error.message === "model down";
  }
  check("model failure surfaces", failed);
  check("failure releases the lease", store.locks.size === 0);
  check(
    "failed turn keeps the user message and no assistant",
    texts(store, scope).join("|") === "user:boom"
  );
  let recovered = [];
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-NEXT",
    userText: "next",
    pollMs: 5,
    run: async (messages) => {
      recovered = messages.map((item) => item.content);
      return "recovered";
    },
  });
  check(
    "next message proceeds and still sees the failed user text",
    recovered.includes("boom") && recovered.includes("next") && store.locks.size === 0
  );

  let runs = 0;
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-RETRY",
    userText: "retry me",
    pollMs: 5,
    run: async () => {
      runs += 1;
      if (runs === 1) throw new Error("model down");
      return "retry answer";
    },
  }).catch(() => {});
  let deliveries = 0;
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-RETRY",
    userText: "retry me",
    pollMs: 5,
    run: async () => {
      runs += 1;
      return "retry answer";
    },
    deliver: async () => {
      deliveries += 1;
    },
  });
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-RETRY",
    userText: "retry me",
    pollMs: 5,
    run: async () => {
      runs += 1;
      return "should not run";
    },
    deliver: async () => {
      deliveries += 1;
    },
  });
  const retryUsers = store.messages.filter(
    (row) => row.message_sid === "SM-RETRY" && row.role === "user"
  );
  const retryAssistants = store.messages.filter(
    (row) => row.role === "assistant" && row.body === "retry answer"
  );
  check("one user row for a retried sid", retryUsers.length === 1);
  check("one assistant row after the retry completes", retryAssistants.length === 1);
  check("completed retry does not run or send again", runs === 2 && deliveries === 1);
}

console.log("\nSTALE LEASE");
{
  const store = createStore();
  const scope = { tenantId: T1, agentId: A1, senderPhone: "971500000008" };
  const key = `${T1}|${A1}|971500000008`;
  store.locks.set(key, { token: "dead-worker", lockedUntil: Date.now() - 1000 });
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-STALE",
    userText: "after crash",
    pollMs: 5,
    run: async () => "resumed",
  });
  check("expired lease does not block the next turn", texts(store, scope).includes("assistant:resumed"));
  check("expired lease was replaced and released", !store.locks.has(key));

  store.locks.set(key, { token: "live-worker", lockedUntil: Date.now() + 60_000 });
  let busy = false;
  try {
    await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-BUSY",
      userText: "wait",
      pollMs: 10,
      waitMs: 30,
      run: async () => "nope",
    });
  } catch (error) {
    busy = /busy/i.test(error.message);
  }
  check("a live lease is not stolen", busy && store.locks.get(key)?.token === "live-worker");
}

console.log("\nSTALE OWNER");
{
  const store = createStore();
  const scope = { tenantId: T1, agentId: A1, senderPhone: "971500000010" };
  const key = `${T1}|${A1}|971500000010`;
  const stolen = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let releaseHold;
  const hold = new Promise((resolve) => {
    releaseHold = resolve;
  });
  let deliveries = 0;
  const stale = withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-STALE-OWNER",
    userText: "Message A",
    pollMs: 5,
    waitMs: 3000,
    run: async () => {
      store.locks.set(key, { token: stolen, lockedUntil: Date.now() + 150_000 });
      await hold;
      return "assistant A from the stale worker";
    },
    deliver: async () => {
      deliveries += 1;
    },
  });
  const started = Date.now();
  while (store.locks.get(key)?.token !== stolen && Date.now() - started < 1000) {
    await sleep(5);
  }
  releaseHold();
  const outcome = await stale;
  check("stale worker does not send", deliveries === 0 && outcome.abandoned === true);
  check(
    "stale worker does not insert its assistant row",
    !store.messages.some((row) => row.body === "assistant A from the stale worker")
  );
  check("stale worker does not release the new lease", store.locks.get(key)?.token === stolen);
  store.locks.delete(key);

  let bSeen = [];
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-AFTER-TAKEOVER",
    userText: "Message B",
    pollMs: 5,
    waitMs: 3000,
    run: async (messages) => {
      bSeen = messages.map((item) => item.content);
      return "assistant B";
    },
  });
  check(
    "takeover does not record assistant A after assistant B",
    JSON.stringify(texts(store, scope)) ===
      JSON.stringify(["user:Message A", "user:Message B", "assistant:assistant B"])
  );
  check("second worker saw message A and not a stale assistant", bSeen.includes("Message A") && !bSeen.includes("assistant A from the stale worker"));
}

console.log("\nDELIVERY");
{
  const scope = { tenantId: T1, agentId: A1, senderPhone: "971500000031" };

  {
    const store = createStore();
    let runs = 0;
    const failed = await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-SEND-FAIL",
      userText: "Question",
      pollMs: 5,
      run: async () => {
        runs += 1;
        return "Saved answer";
      },
      deliver: async () => {
        throw new Error("twilio 500");
      },
    });
    const saved = store.messages.find((row) => row.role === "assistant");
    check(
      "send failure leaves the assistant unsent",
      failed.delivered === false && saved && !saved.sent_at && runs === 1,
      failed && String(failed.delivered)
    );
    let resent = "";
    const retry = await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-SEND-FAIL",
      userText: "Question",
      pollMs: 5,
      run: async () => {
        runs += 1;
        return "should not run";
      },
      deliver: async (body) => {
        resent = body;
      },
    });
    check(
      "retry sends the same saved answer without a second model run",
      resent === "Saved answer" && runs === 1 && retry.delivered === true && Boolean(saved.sent_at)
    );
  }

  {
    const store = createStore();
    let runs = 0;
    let requested = 0;
    await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-BEFORE-SEND",
      userText: "Question",
      pollMs: 5,
      run: async () => {
        runs += 1;
        return "Saved answer";
      },
      deliver: async () => {
        throw new Error("process died before the WhatsApp request");
      },
    });
    const saved = store.messages.find((row) => row.role === "assistant");
    check("crash before send leaves the assistant unsent", saved && !saved.sent_at && requested === 0);
    await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-BEFORE-SEND",
      userText: "Question",
      pollMs: 5,
      run: async () => {
        runs += 1;
        return "should not run";
      },
      deliver: async () => {
        requested += 1;
      },
    });
    check("retry after a pre-send crash sends once without a model rerun", requested === 1 && runs === 1 && Boolean(saved.sent_at));
  }

  {
    const store = createStore();
    let runs = 0;
    let sends = 0;
    await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-SENT",
      userText: "Question",
      pollMs: 5,
      run: async () => {
        runs += 1;
        return "Saved answer";
      },
      deliver: async () => {
        sends += 1;
      },
    });
    await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-SENT",
      userText: "Question",
      pollMs: 5,
      run: async () => {
        runs += 1;
        return "should not run";
      },
      deliver: async () => {
        sends += 1;
      },
    });
    const saved = store.messages.find((row) => row.role === "assistant");
    check("successful send marks sent_at and a retry does not send again", sends === 1 && runs === 1 && Boolean(saved?.sent_at));
  }

  {
    const store = createStore();
    let runs = 0;
    let accepted = 0;
    const first = await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-AFTER-ACCEPT",
      userText: "Question",
      pollMs: 5,
      run: async () => {
        runs += 1;
        return "Saved answer";
      },
      deliver: async () => {
        accepted += 1;
        throw new Error("process died after the provider accepted");
      },
    });
    const saved = store.messages.find((row) => row.role === "assistant");
    check(
      "accepted send without sent_at stays retryable",
      first.delivered === false && accepted === 1 && saved && !saved.sent_at && runs === 1
    );
    await withJarvisConversation({
      supabase: clientFor(store),
      ...scope,
      messageSid: "SM-AFTER-ACCEPT",
      userText: "Question",
      pollMs: 5,
      run: async () => {
        runs += 1;
        return "should not run";
      },
      deliver: async () => {
        accepted += 1;
      },
    });
    check(
      "retry after acceptance may send the same body again and does not rerun the model",
      accepted === 2 && runs === 1 && Boolean(saved.sent_at)
    );
  }

  {
    const store = createStore();
    const senderA = { ...scope, senderPhone: "971500000041" };
    const senderB = { ...scope, senderPhone: "971500000042" };
    let releaseHold;
    const hold = new Promise((resolve) => {
      releaseHold = resolve;
    });
    let aStarted = false;
    const pendingA = withJarvisConversation({
      supabase: clientFor(store),
      ...senderA,
      messageSid: "SM-A",
      userText: "A",
      pollMs: 5,
      run: async () => "answer A",
      deliver: async () => {
        aStarted = true;
        await hold;
      },
    });
    const started = Date.now();
    while (!aStarted && Date.now() - started < 1000) await sleep(5);
    let bSent = 0;
    await withJarvisConversation({
      supabase: clientFor(store),
      ...senderB,
      messageSid: "SM-B",
      userText: "B",
      pollMs: 5,
      run: async () => "answer B",
      deliver: async () => {
        bSent += 1;
      },
    });
    check("another sender is delivered while the first send is in progress", aStarted && bSent === 1);
    releaseHold();
    await pendingA;
  }
}

console.log("\nSAME SID OVERLAP");
{
  const store = createStore();
  const scope = { tenantId: T1, agentId: A1, senderPhone: "971500000061" };
  let releaseHold;
  const hold = new Promise((resolve) => {
    releaseHold = resolve;
  });
  let runs = 0;
  let deliveries = 0;
  let holding = false;
  const first = withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-SAME",
    userText: "Same question",
    pollMs: 5,
    waitMs: 3000,
    run: async () => {
      runs += 1;
      holding = true;
      await hold;
      return "Same answer";
    },
    deliver: async () => {
      deliveries += 1;
    },
  });
  const started = Date.now();
  while (!holding && Date.now() - started < 1000) await sleep(5);
  const second = withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-SAME",
    userText: "Same question",
    pollMs: 5,
    waitMs: 3000,
    run: async () => {
      runs += 1;
      return "should not run";
    },
    deliver: async () => {
      deliveries += 1;
    },
  });
  await sleep(40);
  check("overlapping same SID does not start a second model", runs === 1 && holding);
  releaseHold();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const users = store.messages.filter(
    (row) => row.role === "user" && row.message_sid === "SM-SAME"
  );
  const assistants = store.messages.filter(
    (row) => row.role === "assistant" && row.sender_phone === scope.senderPhone
  );
  check(
    "overlapping same SID keeps one user row, one assistant, and one delivery",
    users.length === 1 && assistants.length === 1 && runs === 1 && deliveries === 1
  );
  check(
    "second same-SID worker does not deliver again",
    firstResult.delivered === true &&
      firstResult.duplicate === false &&
      secondResult.duplicate === true &&
      secondResult.delivered === true
  );
}

console.log("\nDIFFERENT SIDS");
{
  const store = createStore();
  const scope = { tenantId: T1, agentId: A1, senderPhone: "971500000062" };
  let runs = 0;
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-BODY-1",
    userText: "hello",
    pollMs: 5,
    run: async () => {
      runs += 1;
      return "first";
    },
  });
  await withJarvisConversation({
    supabase: clientFor(store),
    ...scope,
    messageSid: "SM-BODY-2",
    userText: "hello",
    pollMs: 5,
    run: async () => {
      runs += 1;
      return "second";
    },
  });
  const users = store.messages.filter(
    (row) => row.role === "user" && row.sender_phone === scope.senderPhone
  );
  check(
    "same body with different SIDs is two turns",
    users.length === 2 && runs === 2 && users[0].body === "hello" && users[1].body === "hello"
  );
}

console.log("\nFACT FOLLOW-UP");
if (!process.env.ANTHROPIC_API_KEY) {
  check("budget follow-up", false, "ANTHROPIC_API_KEY missing");
} else {
  const result = await runJarvisTurn({
    tenantId: T1,
    agentId: A1,
    agentName: "Alex",
    senderPhone: "971500000009",
    messages: [
      { role: "user", content: "Tell me the budget and area." },
      {
        role: "assistant",
        content: "The budget is AED 2,400,000 and the area is Dubai Marina.",
      },
      { role: "user", content: "What was the budget again?" },
    ],
  });
  const text = result.text;
  const hasFigure = /2[,.]?400[,.]?000|2\.4\s*m/i.test(text);
  const denies = /mistake|don't have|do not have|don't actually|no budget|not have that/i.test(text);
  check("follow-up repeats the stated budget", hasFigure && !denies, text);
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nAll Jarvis conversation checks passed.");

/**
 * AgentZero's own WhatsApp sender is not a customer contact.
 * In-memory only. No Supabase, no WhatsApp send, no production phone number.
 *
 * node scripts/qa-jarvis-self-chat.mjs
 */
import { register } from "node:module";
import { readFile } from "node:fs/promises";

register("./alias-loader.mjs", import.meta.url);
register("./qa-jarvis-self-chat-stub.mjs", import.meta.url);

for (const key of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_DB_PASSWORD",
  "ANTHROPIC_API_KEY",
  "TWILIO_WHATSAPP_FROM",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
]) {
  delete process.env[key];
}

const {
  agentZeroSelfWaIds,
  agentZeroWhatsAppFromAddress,
  bindAgentZeroInboundTo,
  isAgentZeroSelfContact,
} = await import("../src/lib/jarvis/self-chat.js");
const { getVisibleInboxLead, inboxLeadVisible, listVisibleInboxLeadIds } =
  await import("../src/lib/jarvis/visibility.js");
const { getJarvisLatestMessages, getJarvisLeadStory, searchJarvisLeadByName } =
  await import("../src/lib/jarvis/leads-tools.js");
const { getJarvisRecentConversations } = await import(
  "../src/lib/kb/live-conversations.js"
);
const { isJarvisAffirmative, isJarvisAmbiguousAck, isJarvisNegative } =
  await import("../src/lib/jarvis/confirm.js");

const T1 = "tenant-1";
const T2 = "tenant-2";
const A1 = "agent-1";
const A2 = "agent-2";
const SELF = "971400000001";
const AGENT_PERSONAL = "971500000111";
const CUSTOMER = "971500000222";
const SIMILAR = "971500000333";
const OTHER_AGENT_PHONE = "971500000444";
const FOREIGN_PHONE = "971500000555";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function matchOr(row, expr) {
  return String(expr || "")
    .split(",")
    .some((part) => {
      const isNull = part.match(/^([a-z_]+)\.is\.null$/);
      if (isNull) return row[isNull[1]] == null;
      const match = part.match(/^([a-z_]+)\.(eq|ilike|like)\.(.*)$/);
      if (!match) return false;
      const value = String(row[match[1]] || "");
      if (match[2] === "eq") return value === match[3];
      const pattern = match[3].replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
      return new RegExp(`^${pattern}$`, "i").test(value);
    });
}

function createDb(store) {
  return {
    from(table) {
      const state = { filters: [], limit: Infinity };
      const chain = {
        select() {
          return chain;
        },
        eq(key, value) {
          state.filters.push((row) => row[key] === value);
          return chain;
        },
        neq(key, value) {
          state.filters.push((row) => row[key] !== value);
          return chain;
        },
        in(key, values) {
          const allowed = new Set(values);
          state.filters.push((row) => allowed.has(row[key]));
          return chain;
        },
        or(expr) {
          state.filters.push((row) => matchOr(row, expr));
          return chain;
        },
        gte() {
          return chain;
        },
        order() {
          return chain;
        },
        limit(count) {
          state.limit = count;
          return chain;
        },
        maybeSingle() {
          return Promise.resolve(finish(true));
        },
        single() {
          return Promise.resolve(finish(true));
        },
        then(resolve, reject) {
          return Promise.resolve(finish(false)).then(resolve, reject);
        },
      };

      function finish(single) {
        const rows = (store[table] || [])
          .filter((row) => state.filters.every((fn) => fn(row)))
          .slice(0, state.limit)
          .map((row) => {
            if (table !== "whatsapp-messages") return { ...row };
            const lead = (store.jarvis_leads || []).find(
              (item) => item.id === row.jarvis_lead_id
            );
            return { ...row, jarvis_leads: lead || null };
          });
        return { data: single ? rows[0] || null : rows, error: null };
      }

      return chain;
    },
  };
}

function seed() {
  const leads = [
    { id: "self", tenant_id: T1, assigned_agent_id: null, wa_id: SELF, push_name: "Alex" },
    {
      id: "personal",
      tenant_id: T1,
      assigned_agent_id: null,
      wa_id: AGENT_PERSONAL,
      push_name: "Sam Agent",
    },
    {
      id: "customer",
      tenant_id: T1,
      assigned_agent_id: null,
      wa_id: CUSTOMER,
      push_name: "Alice Buyer",
    },
    {
      id: "similar",
      tenant_id: T1,
      assigned_agent_id: null,
      wa_id: SIMILAR,
      push_name: "Alex",
    },
    {
      id: "other-agent",
      tenant_id: T1,
      assigned_agent_id: A2,
      wa_id: OTHER_AGENT_PHONE,
      push_name: "Other Lead",
    },
    {
      id: "foreign",
      tenant_id: T2,
      assigned_agent_id: null,
      wa_id: FOREIGN_PHONE,
      push_name: "Foreign Lead",
    },
  ];
  const messages = leads.map((lead, index) => ({
    id: `m-${lead.id}`,
    tenant_id: lead.tenant_id,
    jarvis_lead_id: lead.id,
    direction: "inbound",
    body:
      lead.id === "customer"
        ? "Looking for a 2-bed in Marina."
        : `Note ${index} for ${lead.id}.`,
    msg_type: "text",
    timestamp: new Date(Date.UTC(2026, 9, 5, 8, index)).toISOString(),
  }));
  return { jarvis_leads: leads, "whatsapp-messages": messages, calls: [] };
}

function useDb() {
  globalThis.__selfChatDb = createDb(seed());
}

console.log("\nIDENTITY");
{
  await bindAgentZeroInboundTo("whatsapp:+971 400 000 001", () => {
    check("formatted inbound To matches digits", isAgentZeroSelfContact(SELF));
    check(
      "whatsapp plus and dashes match",
      isAgentZeroSelfContact("whatsapp:+971-400-000-001")
    );
    check("one-digit difference stays a customer", !isAgentZeroSelfContact("971400000002"));
    check(
      "agent personal number is not AgentZero",
      !isAgentZeroSelfContact(AGENT_PERSONAL)
    );
  });
  check("outside the inbound binding nothing is self", !isAgentZeroSelfContact(SELF));

  process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+971 400 000 001";
  check("configured from-address matches", isAgentZeroSelfContact("971400000001"));
  check(
    "from-address keeps the whatsapp prefix",
    agentZeroWhatsAppFromAddress() === "whatsapp:+971 400 000 001"
  );
  process.env.TWILIO_PHONE_NUMBER = "+971500000999";
  check(
    "voice number is not excluded while from-address is set",
    !isAgentZeroSelfContact("971500000999")
  );
  delete process.env.TWILIO_WHATSAPP_FROM;
  check(
    "phone number is the fallback only when from-address is unset",
    isAgentZeroSelfContact("971500000999")
  );
  delete process.env.TWILIO_PHONE_NUMBER;
  check("cleared config excludes nobody", !isAgentZeroSelfContact(SELF));
}

console.log("\nDISCOVERY");
useDb();
await bindAgentZeroInboundTo(`whatsapp:+${SELF}`, async () => {
  const selfLead = seed().jarvis_leads[0];
  const customer = seed().jarvis_leads[2];
  const similar = seed().jarvis_leads[3];
  const personal = seed().jarvis_leads[1];

  check("self lead is not visible", !inboxLeadVisible(selfLead, A1));
  check("business customer stays visible", inboxLeadVisible(customer, A1));
  check("same name different phone stays visible", inboxLeadVisible(similar, A1));
  check("agent personal number stays visible", inboxLeadVisible(personal, A1));
  check(
    "other agent assignment stays hidden",
    !inboxLeadVisible(seed().jarvis_leads[4], A1)
  );

  const ids = await listVisibleInboxLeadIds(globalThis.__selfChatDb, {
    tenantId: T1,
    agentId: A1,
  });
  check("recent-id set omits self", !ids.has("self"));
  check("recent-id set keeps customer", ids.has("customer"));
  check("recent-id set keeps similar name", ids.has("similar"));
  check("recent-id set keeps agent personal number", ids.has("personal"));
  check("recent-id set omits other agent", !ids.has("other-agent"));
  check("recent-id set omits other tenant", !ids.has("foreign"));

  const story = await getJarvisLeadStory(T1, A1, "self");
  const customerStory = await getJarvisLeadStory(T1, A1, "customer");
  check("lead history refuses self", story == null);
  check(
    "lead history returns the business customer",
    customerStory?.lead?.phone === `+${CUSTOMER}` &&
      customerStory.events.some((event) => event.type === "message")
  );
  const foreign = await getVisibleInboxLead(globalThis.__selfChatDb, {
    tenantId: T1,
    agentId: A1,
    leadId: "foreign",
  });
  check("other tenant lead id is hidden", foreign == null);

  const latest = await getJarvisLatestMessages(T1, A1, 20);
  const latestIds = new Set(latest.map((row) => row.leadId));
  check("latest messages omit self", !latestIds.has("self"));
  check("latest messages keep customer", latestIds.has("customer"));
  check("latest messages keep similar name", latestIds.has("similar"));

  const named = await searchJarvisLeadByName(T1, A1, "Alex");
  const namedPhones = named.map((row) => row.phone);
  check("name search omits self phone", !namedPhones.includes(`+${SELF}`));
  check("name search keeps the other Alex", namedPhones.includes(`+${SIMILAR}`));

  const recent = await getJarvisRecentConversations(T1, A1, {
    limit: 10,
    messageLimit: 8,
  });
  const recentPhones = recent.map((row) => row.wa_id);
  check("recent conversations omit self", !recentPhones.includes(SELF));
  check("recent conversations keep customer", recentPhones.includes(CUSTOMER));
  check(
    "recent conversations keep agent personal number",
    recentPhones.includes(AGENT_PERSONAL)
  );
});

console.log("\nOVERLAPPING BINDS");
{
  delete process.env.TWILIO_WHATSAPP_FROM;
  delete process.env.TWILIO_PHONE_NUMBER;
  const toA = "971411111111";
  const toB = "971422222222";
  let release;
  const started = new Promise((resolve) => {
    release = resolve;
  });
  const contextA = bindAgentZeroInboundTo(`whatsapp:+${toA}`, async () => {
    await started;
    const ids = agentZeroSelfWaIds();
    return {
      own: ids.has(toA) && isAgentZeroSelfContact(`whatsapp:+${toA}`),
      other: ids.has(toB) || isAgentZeroSelfContact(toB),
      size: ids.size,
    };
  });
  const contextB = bindAgentZeroInboundTo(`+${toB}`, async () => {
    await started;
    const ids = agentZeroSelfWaIds();
    return {
      own: ids.has(toB) && isAgentZeroSelfContact(toB),
      other: ids.has(toA) || isAgentZeroSelfContact(`whatsapp:+${toA}`),
      size: ids.size,
    };
  });
  release();
  const [a, b] = await Promise.all([contextA, contextB]);
  check("overlapping bind A sees only its To", a.own && !a.other && a.size === 1);
  check("overlapping bind B sees only its To", b.own && !b.other && b.size === 1);
  check("after both binds, nothing stays bound", agentZeroSelfWaIds().size === 0);
}

console.log("\nCONCURRENT AGENT AND TENANT ISOLATION");
{
  delete process.env.TWILIO_WHATSAPP_FROM;
  delete process.env.TWILIO_PHONE_NUMBER;
  const toA = "971411111111";
  const toB = "971422222222";
  const leads = [
    { id: "az-a", tenant_id: T1, assigned_agent_id: null, wa_id: toA, push_name: "Sender A" },
    { id: "az-b", tenant_id: T1, assigned_agent_id: null, wa_id: toB, push_name: "Sender B" },
    { id: "cust", tenant_id: T1, assigned_agent_id: null, wa_id: CUSTOMER, push_name: "Alice Buyer" },
    { id: "owned-a2", tenant_id: T1, assigned_agent_id: A2, wa_id: OTHER_AGENT_PHONE, push_name: "Other Lead" },
    { id: "az-a-t2", tenant_id: T2, assigned_agent_id: null, wa_id: toA, push_name: "Sender A" },
    { id: "az-b-t2", tenant_id: T2, assigned_agent_id: null, wa_id: toB, push_name: "Sender B" },
    { id: "foreign-cust", tenant_id: T2, assigned_agent_id: A1, wa_id: FOREIGN_PHONE, push_name: "Foreign Lead" },
  ];
  const db = createDb({ jarvis_leads: leads, "whatsapp-messages": [], calls: [] });
  globalThis.__selfChatDb = db;
  let release;
  const started = new Promise((resolve) => {
    release = resolve;
  });
  const contextA = bindAgentZeroInboundTo(`whatsapp:+${toA}`, async () => {
    await started;
    const ids = await listVisibleInboxLeadIds(db, { tenantId: T1, agentId: A1 });
    return {
      seesOtherTo: isAgentZeroSelfContact(toB),
      ids,
      otherAgentHidden: !inboxLeadVisible(leads[3], A1),
    };
  });
  const contextB = bindAgentZeroInboundTo(`whatsapp:+${toB}`, async () => {
    await started;
    const ids = await listVisibleInboxLeadIds(db, { tenantId: T2, agentId: A1 });
    return {
      seesOtherTo: isAgentZeroSelfContact(toA),
      ids,
    };
  });
  release();
  const [a, b] = await Promise.all([contextA, contextB]);
  check("tenant A bind does not adopt tenant B To", !a.seesOtherTo);
  check("tenant B bind does not adopt tenant A To", !b.seesOtherTo);
  check("agent A hides its own sender", !a.ids.has("az-a"));
  check("agent A still lists the other sender number", a.ids.has("az-b"));
  check("agent A still lists the business customer", a.ids.has("cust"));
  check("other agent assignment stays hidden during overlap", a.otherAgentHidden && !a.ids.has("owned-a2"));
  check("tenant A query excludes tenant B during overlap", !a.ids.has("foreign-cust") && !a.ids.has("az-b-t2"));
  check("tenant B hides its own sender", !b.ids.has("az-b-t2"));
  check("tenant B still lists the other sender number", b.ids.has("az-a-t2"));
  check("tenant B still lists its own customer", b.ids.has("foreign-cust"));
  check("tenant B query excludes tenant A during overlap", !b.ids.has("cust") && !b.ids.has("az-a"));
}

console.log("\nEMPTY INBOUND TO");
{
  delete process.env.TWILIO_WHATSAPP_FROM;
  delete process.env.TWILIO_PHONE_NUMBER;
  useDb();
  const db = globalThis.__selfChatDb;
  const unbound = await listVisibleInboxLeadIds(db, { tenantId: T1, agentId: A1 });
  check("unbound discovery includes the sender row", unbound.has("self"));
  check("unbound discovery still hides the other agent", !unbound.has("other-agent"));
  check("unbound discovery still hides the other tenant", !unbound.has("foreign"));
  check("unbound call does not invent a self id", agentZeroSelfWaIds().size === 0);

  const emptyBound = await bindAgentZeroInboundTo("", async () => {
    const ids = agentZeroSelfWaIds();
    const visible = await listVisibleInboxLeadIds(db, { tenantId: T1, agentId: A1 });
    return { ids, visible };
  });
  check("empty To adds no self id", emptyBound.ids.size === 0 && !emptyBound.ids.has(""));
  check("empty To does not mark a customer as self", !isAgentZeroSelfContact(CUSTOMER));
  const same =
    unbound.size === emptyBound.visible.size &&
    [...unbound].every((id) => emptyBound.visible.has(id));
  check("empty To leaves discovery unchanged", same);
  check("empty To still returns the sender row", emptyBound.visible.has("self"));
  check("empty To still hides the other agent", !emptyBound.visible.has("other-agent"));
  check("empty To still hides the other tenant", !emptyBound.visible.has("foreign"));
}

console.log("\nCONFIRMATION LANGUAGE");
{
  const yes = ["yes", "yeah", "yep", "go ahead", "do it", "confirm"];
  for (const phrase of yes) {
    check(`affirmative: ${phrase}`, isJarvisAffirmative(phrase));
  }
  const no = ["okay", "sure", "alright", "no", "nah", "don't do it", "not now", "yesterday was fine"];
  for (const phrase of no) {
    check(`does not confirm: ${phrase}`, !isJarvisAffirmative(phrase));
  }
  check("okay asks for an explicit yes", isJarvisAmbiguousAck("okay"));
  check("sure asks for an explicit yes", isJarvisAmbiguousAck("sure"));
  check("alright is not an ambiguous ack", !isJarvisAmbiguousAck("alright"));
  check("don't do it is a refusal", isJarvisNegative("don't do it"));
  check("not now does not confirm or cancel", !isJarvisNegative("not now"));
  check(
    "a sentence containing yes does not confirm",
    !isJarvisAffirmative("yes that viewing yesterday was fine")
  );
}

console.log("\nPRIVATE CONVERSATION UNTOUCHED");
{
  const conversation = await readFile(
    new URL("../src/lib/jarvis/conversation.js", import.meta.url),
    "utf8"
  );
  const identity = await readFile(
    new URL("../src/lib/jarvis/self-chat.js", import.meta.url),
    "utf8"
  );
  check(
    "durable transcript does not import the self-chat filter",
    !conversation.includes("self-chat") && !conversation.includes("isAgentZeroSelfContact")
  );
  check("identity module has no hardcoded phone", !/\d{8,}/.test(identity));
}

if (failures) {
  console.error(`\n${failures} self-chat check(s) failed.`);
  process.exit(1);
}
console.log("\nAll AgentZero self-chat checks passed.");

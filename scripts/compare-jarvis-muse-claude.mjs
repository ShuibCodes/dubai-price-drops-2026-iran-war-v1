#!/usr/bin/env node
/**
 * Compare full Jarvis questions on Claude, Claude with prompt caching, and
 * Meta's Muse Spark.
 *
 * Builds the real Jarvis system prompt and tool list around made-up WhatsApp
 * chats, then runs each agent question through the same loop as
 * runJarvisTurn() (up to 5 rounds, stopping on a confirmation). Tools are
 * never executed: each tool call gets a made-up result built from the fake
 * chats. Nothing touches Supabase, Vapi or email — it only records what each
 * model does and what the whole question costs.
 *
 * Every question starts with a cold cache, so the caching numbers are the
 * conservative case (no cache carried over from a previous question).
 *
 * Usage:
 *   node scripts/compare-jarvis-muse-claude.mjs
 *
 * Requires in .env.local: ANTHROPIC_API_KEY, MODEL_API_KEY (Meta Model API).
 */
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

register("./alias-loader.mjs", import.meta.url);
applyEnv(loadEnvFile());

for (const key of ["ANTHROPIC_API_KEY", "MODEL_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env.local`);
    process.exit(1);
  }
}

const { systemPrompt, jarvisToolDefinitions } = await import(
  "../src/lib/jarvis/engine.js"
);
const { formatLiveContext } = await import("../src/lib/kb/live-conversations.js");

const MAX_TOOL_ROUNDS = 5; // same as runJarvisTurn()

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

// Made-up leads only. Live Jarvis loads 5 chats x 8 messages.
const FAKE_CONVERSATIONS = [
  {
    push_name: "Omar Haddad",
    wa_id: "971500000101",
    last_message_at: hoursAgo(1),
    messages: [
      { direction: "inbound", body: "Hi, saw your post about Marina distressed deals" },
      { direction: "outbound", body: "Hi Omar! Yes, a few came in this week. What budget are you working with?" },
      { direction: "inbound", body: "Around 1.8M, cash buyer" },
      { direction: "outbound", body: "Perfect. Investment or to live in?" },
      { direction: "inbound", body: "Investment, want good rental yield" },
      { direction: "outbound", body: "Got it, I'll shortlist 2-3 options with yields" },
      { direction: "inbound", body: "Great, can we view on Saturday?" },
      { direction: "inbound", body: "Also is service charge included in the yield numbers?" },
    ],
  },
  {
    push_name: "Sara Khan",
    wa_id: "971500000102",
    last_message_at: hoursAgo(3),
    messages: [
      { direction: "inbound", body: "Hello, interested in a 2 bed in JVC" },
      { direction: "outbound", body: "Hi Sara, when are you looking to move?" },
      { direction: "inbound", body: "Within 2 months, my lease ends in December" },
      { direction: "outbound", body: "Viewing tomorrow at 4pm works?" },
      { direction: "inbound", body: "Yes 4pm is fine" },
      { direction: "inbound", body: "Can you send the floor plan before?" },
    ],
  },
  {
    push_name: "Daniel Price",
    wa_id: "447700900103",
    last_message_at: hoursAgo(26),
    messages: [
      { direction: "inbound", body: "Looking at off-plan in Business Bay, what payment plans are there?" },
      { direction: "outbound", body: "Most developers do 60/40 right now. Budget?" },
      { direction: "inbound", body: "Up to 2.5M. Based in London, would buy remotely" },
      { direction: "outbound", body: "No problem, we handle remote purchases. I'll send options" },
    ],
  },
  {
    push_name: "Fatima Al Mansoori",
    wa_id: "971500000104",
    last_message_at: hoursAgo(80),
    messages: [
      { direction: "inbound", body: "مرحبا، عندكم فلل في المرابع العربية؟" },
      { direction: "outbound", body: "أهلاً فاطمة، نعم عندنا خيارات. كم الميزانية تقريباً؟" },
      { direction: "inbound", body: "حوالي ٥ مليون" },
      { direction: "outbound", body: "ممتاز، بأرسل لك خيارات بكرة" },
    ],
  },
  {
    push_name: "Ravi Menon",
    wa_id: "971500000105",
    last_message_at: hoursAgo(170),
    messages: [
      { direction: "inbound", body: "Is the Downtown 1 bed still available?" },
      { direction: "outbound", body: "Hi Ravi, yes it is. Want to see it this week?" },
      { direction: "inbound", body: "Let me check with my wife and come back" },
    ],
  },
];

const QUESTIONS = [
  "Who messaged me today?",
  "What did Omar say about his budget and what does he want?",
  "Which leads have gone quiet and need a follow-up?",
  "Find everyone interested in Marina or JVC",
  "Call Sara and tell her the viewing is moved to 5pm",
];

function leadSummary(c) {
  return {
    name: c.push_name,
    phone: `+${c.wa_id}`,
    lastMessageAt: c.last_message_at,
    lastMessage: c.messages.at(-1).body,
    lastFrom: c.messages.at(-1).direction === "outbound" ? "me" : "lead",
  };
}

// Made-up tool results, shaped loosely like the real ones. Anything that
// would act in the real world returns a confirmation, as Jarvis does.
function fakeToolResult(name, input = {}) {
  const hours = Number(input.hours) || 24;
  const matchName = (c) =>
    c.push_name.toLowerCase().includes(String(input.name || "").toLowerCase());

  switch (name) {
    case "get_inbox_activity":
    case "get_latest_messages":
      return {
        found: true,
        leads: FAKE_CONVERSATIONS.filter(
          (c) => Date.now() - new Date(c.last_message_at) <= hours * 3600 * 1000
        ).map(leadSummary),
      };
    case "get_stale_conversations":
      return {
        found: true,
        leads: FAKE_CONVERSATIONS.filter(
          (c) => Date.now() - new Date(c.last_message_at) > 24 * 3600 * 1000
        ).map(leadSummary),
      };
    case "get_unreplied_conversations":
      return {
        found: true,
        leads: FAKE_CONVERSATIONS.filter((c) => c.messages.at(-1).direction === "inbound").map(
          leadSummary
        ),
      };
    case "search_lead_by_name":
    case "get_lead_story": {
      const matches = FAKE_CONVERSATIONS.filter(matchName);
      return matches.length
        ? { found: true, leads: matches.map((c) => ({ ...leadSummary(c), messages: c.messages })) }
        : { found: false };
    }
    case "search_conversations": {
      const q = String(input.query || "").toLowerCase();
      const matches = FAKE_CONVERSATIONS.filter((c) =>
        c.messages.some((m) => m.body.toLowerCase().includes(q))
      );
      return { found: matches.length > 0, leads: matches.map(leadSummary) };
    }
    case "place_relay_call":
    case "start_target_call":
    case "save_jarvis_contact":
    case "set_lead_name":
    case "send_email":
    case "start_cold_batch": {
      const lead = FAKE_CONVERSATIONS.find(matchName);
      return {
        requiresConfirmation: true,
        action: name,
        name: lead?.push_name || input.name,
        phone: lead ? `+${lead.wa_id}` : null,
        task: input.task,
      };
    }
    default:
      return { found: false, note: "No data in this test." };
  }
}

const baseSystem = systemPrompt({
  liveContext: formatLiveContext(FAKE_CONVERSATIONS),
  savedListsPrompt: "",
  agentName: "Test Agent",
  runStatusBlock: "",
});

// USD per million tokens. Muse bills thinking tokens as output.
const PRICES = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "muse-spark-1.3": { input: 1.25, output: 4.25, cacheWrite: 1.25, cacheRead: 0.15 },
};

const openaiTools = jarvisToolDefinitions.map((tool) => ({
  type: "function",
  function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
}));

const CONFIGS = [
  {
    label: "Claude Sonnet 4.6 (live today)",
    url: "https://api.anthropic.com/v1/messages",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY },
    body: { model: "claude-sonnet-4-6", max_tokens: 1400 },
  },
  {
    label: "Claude Sonnet 4.6 + prompt caching",
    url: "https://api.anthropic.com/v1/messages",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY },
    body: { model: "claude-sonnet-4-6", max_tokens: 1400, cache_control: { type: "ephemeral" } },
  },
  {
    label: "Muse, low effort (Messages API)",
    url: "https://api.meta.ai/v1/messages",
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
    body: { model: "muse-spark-1.3", max_tokens: 4096, output_config: { effort: "low" } },
  },
  {
    label: "Muse, minimal effort (OpenAI-style API)",
    format: "openai",
    url: "https://api.meta.ai/v1/chat/completions",
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
    body: { model: "muse-spark-1.3", max_tokens: 4096, reasoning_effort: "minimal" },
  },
];

async function post(config, body) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      ...config.headers,
      ...(config.format === "openai" ? {} : { "anthropic-version": "2023-06-01" }),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || `HTTP ${response.status}`);
  return json;
}

function usageOf(config, json) {
  const u = json.usage || {};
  if (config.format === "openai") {
    const cached = u.prompt_tokens_details?.cached_tokens || 0;
    return {
      input: (u.prompt_tokens || 0) - cached,
      cacheWrite: 0,
      cacheRead: cached,
      output: u.completion_tokens || 0,
      thinking: u.completion_tokens_details?.reasoning_tokens || 0,
    };
  }
  return {
    input: u.input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    output: u.output_tokens || 0,
    thinking: u.output_tokens_details?.thinking_tokens || 0,
  };
}

// One full question, mirroring the runJarvisTurn() loop.
async function runQuestion(config, question, system) {
  const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };
  const toolsUsed = [];
  const started = Date.now();
  let finalText = "";
  let rounds = 0;
  const openai = config.format === "openai";
  const messages = openai
    ? [{ role: "system", content: system }, { role: "user", content: question }]
    : [{ role: "user", content: question }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    rounds = round + 1;
    const json = await post(
      config,
      openai
        ? { ...config.body, tools: openaiTools, messages }
        : { ...config.body, tools: jarvisToolDefinitions, system, messages }
    );
    for (const [k, v] of Object.entries(usageOf(config, json))) usage[k] += v;

    const calls = openai
      ? (json.choices?.[0]?.message?.tool_calls || []).map((c) => ({
          id: c.id,
          name: c.function?.name,
          input: JSON.parse(c.function?.arguments || "{}"),
        }))
      : (json.content || [])
          .filter((b) => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    if (!calls.length) {
      finalText = openai
        ? String(json.choices?.[0]?.message?.content || "")
        : (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      break;
    }

    if (openai) messages.push(json.choices[0].message);
    else messages.push({ role: "assistant", content: json.content });

    let confirmation = null;
    const results = calls.map((call) => {
      toolsUsed.push(call.name);
      const result = fakeToolResult(call.name, call.input);
      if (result.requiresConfirmation) confirmation = result;
      return { call, result };
    });

    if (confirmation) {
      finalText = `[asks the agent to confirm: ${confirmation.action} ${confirmation.name || ""}]`;
      break;
    }

    if (openai) {
      for (const { call, result } of results) {
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    } else {
      messages.push({
        role: "user",
        content: results.map(({ call, result }) => ({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result),
        })),
      });
    }
  }

  const price = PRICES[config.body.model];
  const cost =
    (usage.input * price.input +
      usage.cacheWrite * price.cacheWrite +
      usage.cacheRead * price.cacheRead +
      usage.output * price.output) /
    1e6;
  return { rounds, usage, cost, ms: Date.now() - started, toolsUsed, finalText: finalText.trim() };
}

console.log(`Jarvis system prompt: ${baseSystem.length.toLocaleString()} characters, ${jarvisToolDefinitions.length} tools`);

const totals = CONFIGS.map(() => ({ cost: 0, ms: 0, rounds: 0, count: 0, failed: 0 }));

for (const question of QUESTIONS) {
  // A fresh first line per question means no cache carries over between
  // questions, for every config alike.
  const system = `Session ${randomUUID()}\n${baseSystem}`;
  console.log(`\n=== Agent asks: ${question} ===`);

  for (const [i, config] of CONFIGS.entries()) {
    console.log(`\n  [${config.label}]`);
    try {
      const r = await runQuestion(config, question, system);
      console.log(`  tools: ${r.toolsUsed.join(", ") || "none"} | rounds: ${r.rounds}`);
      console.log(`  ${r.finalText.replace(/\n+/g, " ").slice(0, 300) || "(EMPTY)"}`);
      console.log(
        `  in=${r.usage.input} cacheWrite=${r.usage.cacheWrite} cacheRead=${r.usage.cacheRead} ` +
          `out=${r.usage.output} (thinking ${r.usage.thinking}) ${r.ms}ms $${r.cost.toFixed(5)}`
      );
      totals[i].cost += r.cost;
      totals[i].ms += r.ms;
      totals[i].rounds += r.rounds;
      totals[i].count += 1;
      if (!r.finalText) totals[i].failed += 1;
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
      totals[i].failed += 1;
    }
  }
}

console.log("\n=== Summary (whole questions, cold cache each time) ===");
for (const [i, config] of CONFIGS.entries()) {
  const t = totals[i];
  const avg = (v) => (t.count ? v / t.count : 0);
  console.log(
    `${config.label}: avg $${avg(t.cost).toFixed(5)}/question ` +
      `(~$${(avg(t.cost) * 1000).toFixed(2)} per 1,000), ` +
      `avg ${avg(t.rounds).toFixed(1)} rounds, avg ${Math.round(avg(t.ms))}ms, ` +
      `${t.failed}/${QUESTIONS.length} empty or failed`
  );
}

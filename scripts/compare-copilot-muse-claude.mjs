#!/usr/bin/env node
/**
 * Compare full Copilot questions on Claude, Claude with prompt caching, and
 * Meta's Muse Spark.
 *
 * Builds the real Copilot system prompt and tool list, then runs each ops
 * question through the same loop as runCopilotTurn() (up to 5 rounds,
 * stopping on a confirmation). Tools are never executed: each tool call gets a
 * made-up result. Nothing touches Supabase or Vapi — no batches are queued and
 * no calls are placed. It only records what each model does and what the
 * whole question costs.
 *
 * Every question starts with a cold cache (no cache carried over between
 * questions), so the caching numbers are the conservative case.
 *
 * Usage:
 *   node scripts/compare-copilot-muse-claude.mjs
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

const { systemPrompt, copilotToolDefinitions } = await import(
  "../src/lib/copilot/engine.js"
);

const MAX_TOOL_ROUNDS = 5; // same as runCopilotTurn()

// Made-up leads and calls only.
const FAKE_LEADS = [
  { leadId: "lead-1", name: "Ahmed Rahman", phone: "+971500000201", source: "downtown-owners", intent: "sell", budget: "3.2M", areas: "Downtown", timeline: "3 months", callAttempts: 1 },
  { leadId: "lead-2", name: "Priya Nair", phone: "+971500000202", source: "downtown-owners", intent: "invest", budget: "1.5M", areas: "Downtown, Business Bay", timeline: "this month", callAttempts: 0 },
  { leadId: "lead-3", name: "Tom Hughes", phone: "+447700900203", source: "burj-lake", intent: "buy to live", budget: "2.8M", areas: "Burj Lake", timeline: "6 months", callAttempts: 2 },
  { leadId: "lead-4", name: "Layla Hassan", phone: "+971500000204", source: "jvc-investors", intent: "invest", budget: "900K", areas: "JVC", timeline: "this quarter", callAttempts: 0 },
  { leadId: "lead-5", name: "Marco Rossi", phone: "+393400000205", source: "downtown-owners", intent: "sell", budget: "4.1M", areas: "Downtown", timeline: "next year", callAttempts: 1 },
];

const FAKE_CALLS = [
  { leadId: "lead-1", name: "Ahmed Rahman", phone: "+971500000201", outcome: "engaged", intent: "sell", budget: "3.2M", areas: "Downtown", timeline: "3 months", callbackTime: "Sunday 4pm", wantsDistressedDeals: false },
  { leadId: "lead-2", name: "Priya Nair", phone: "+971500000202", outcome: "qualified", intent: "invest", budget: "1.5M", areas: "Downtown, Business Bay", timeline: "this month", wantsDistressedDeals: true },
  { leadId: "lead-3", name: "Tom Hughes", phone: "+447700900203", outcome: "no_answer" },
  { leadId: "lead-4", name: "Layla Hassan", phone: "+971500000204", outcome: "engaged", intent: "invest", budget: "900K", areas: "JVC", wantsDistressedDeals: true },
  { leadId: "lead-5", name: "Marco Rossi", phone: "+393400000205", outcome: "not_interested" },
];

const QUESTIONS = [
  "How many leads do we have and how many are uncalled?",
  "How did today's calls go?",
  "What did Ahmed Rahman say on his last call?",
  "Any callbacks pending?",
  "Start a batch of 50 calls to the downtown owners",
];

// Made-up tool results, shaped loosely like the real ones. Write actions that
// Copilot would run straight away get a fake success; nothing is executed.
function fakeToolResult(name, input = {}) {
  switch (name) {
    case "query_leads":
      return {
        total: 240,
        uncalled: 180,
        source: input.source || null,
        leads: FAKE_LEADS.filter((l) => !input.source || l.source.includes(String(input.source).toLowerCase())),
      };
    case "list_lead_sources":
      return { sources: [{ name: "downtown-owners", count: 120 }, { name: "burj-lake", count: 80 }, { name: "jvc-investors", count: 40 }] };
    case "todays_digest":
      return { date: new Date().toISOString().slice(0, 10), dialed: 64, connected: 22, engaged: 9, qualified: 4, callbacks: 3, calls: FAKE_CALLS };
    case "count_calls_since":
      return { count: 64, sinceIso: input.sinceIso };
    case "list_call_activity":
      return { total: 22, calls: FAKE_CALLS };
    case "get_run_status":
      return { found: false, instruction: "No console run in progress." };
    case "search_lead_by_name": {
      const q = String(input.name || "").toLowerCase();
      const matches = FAKE_LEADS.filter((l) => l.name.toLowerCase().includes(q.split(" ")[0]));
      return { found: matches.length > 0, leads: matches };
    }
    case "get_lead_story": {
      const lead = FAKE_LEADS.find((l) => l.leadId === input.leadId) || FAKE_LEADS[0];
      return { lead, calls: FAKE_CALLS.filter((c) => c.leadId === lead.leadId) };
    }
    case "get_call_detail":
      return {
        name: "Ahmed Rahman",
        phone: "+971500000201",
        startedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        durationSec: 142,
        outcome: "engaged",
        intent: "sell",
        budget: "3.2M",
        areas: "Downtown",
        timeline: "3 months",
        callbackTime: "Sunday 4pm",
        transcript:
          "AI: Hi Ahmed, calling from 1416 about your Downtown apartment.\nUser: Yes, I've been thinking about selling.\nAI: What price would you be happy with?\nUser: Around 3.2 million, but not below. I'm in no rush, maybe 3 months.\nAI: Can a consultant call you back?\nUser: Sunday at 4 works.",
      };
    case "get_pending_callbacks":
      return { callbacks: [{ name: "Ahmed Rahman", phone: "+971500000201", callbackTime: "Sunday 4pm" }, { name: "Layla Hassan", phone: "+971500000204", callbackTime: "Monday 11am" }] };
    case "search_conversations":
      return { matches: FAKE_CALLS.slice(0, 2) };
    case "list_scripts":
      return { live: [{ name: "Downtown distressed v3", version: 3, publishedDaysAgo: 4 }], draft: [{ name: "JVC investors v1" }] };
    case "start_cold_batch":
      return {
        requiresConfirmation: true,
        action: "cold_batch",
        count: Number(input.count),
        confirmationPrompt: `Start ${input.count} calls to ${input.source || "all leads"} with "${input.script || "?"}"? Reply yes to confirm.`,
      };
    case "schedule_batch":
      return { scheduled: true, count: Number(input.count), whenIso: input.whenIso, queuedLeads: FAKE_LEADS.slice(0, 3) };
    case "start_target_call":
      return { queued: true, leadId: input.leadId };
    case "pause_tenant":
    case "resume_tenant":
      return { ok: true };
    default:
      return { found: false, note: "No data in this test." };
  }
}

const basePrompt = systemPrompt("1416 Real Estate", "Test Agent", "");

// USD per million tokens. Muse bills thinking tokens as output.
const PRICES = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "muse-spark-1.3": { input: 1.25, output: 4.25, cacheWrite: 1.25, cacheRead: 0.15 },
};

const CONFIGS = [
  {
    label: "Claude Sonnet 4.6 (live today)",
    url: "https://api.anthropic.com/v1/messages",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY },
    body: { model: "claude-sonnet-4-6", max_tokens: 1200 },
  },
  {
    label: "Claude Sonnet 4.6 + prompt caching",
    url: "https://api.anthropic.com/v1/messages",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY },
    body: { model: "claude-sonnet-4-6", max_tokens: 1200, cache_control: { type: "ephemeral" } },
  },
  {
    // Same settings as src/lib/jarvis/model-client.js would use.
    label: "Muse, low effort (Messages API)",
    url: "https://api.meta.ai/v1/messages",
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
    body: { model: "muse-spark-1.3", max_tokens: 4096, output_config: { effort: "low" } },
  },
];

async function post(config, body) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: { ...config.headers, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || `HTTP ${response.status}`);
  return json;
}

// One full question, mirroring the runCopilotTurn() loop.
async function runQuestion(config, question, system) {
  const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };
  const toolsUsed = [];
  const started = Date.now();
  const messages = [{ role: "user", content: question }];
  let finalText = "";
  let rounds = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    rounds = round + 1;
    const json = await post(config, { ...config.body, tools: copilotToolDefinitions, system, messages });
    const u = json.usage || {};
    usage.input += u.input_tokens || 0;
    usage.cacheWrite += u.cache_creation_input_tokens || 0;
    usage.cacheRead += u.cache_read_input_tokens || 0;
    usage.output += u.output_tokens || 0;
    usage.thinking += u.output_tokens_details?.thinking_tokens || 0;

    const calls = (json.content || []).filter((b) => b.type === "tool_use");
    if (!calls.length) {
      finalText = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      break;
    }

    messages.push({ role: "assistant", content: json.content });
    let confirmation = null;
    const results = calls.map((call) => {
      toolsUsed.push(call.name);
      const result = fakeToolResult(call.name, call.input);
      if (result.requiresConfirmation) confirmation = result;
      return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
    });
    if (confirmation) {
      finalText = `[asks for confirmation: ${confirmation.confirmationPrompt || confirmation.count}]`;
      break;
    }
    messages.push({ role: "user", content: results });
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

console.log(`Copilot system prompt: ${basePrompt.length.toLocaleString()} characters, ${copilotToolDefinitions.length} tools`);

const totals = CONFIGS.map(() => ({ cost: 0, ms: 0, rounds: 0, count: 0, failed: 0 }));

for (const question of QUESTIONS) {
  const system = `Session ${randomUUID()}\n${basePrompt}`;
  console.log(`\n=== Agent asks: ${question} ===`);

  for (const [i, config] of CONFIGS.entries()) {
    console.log(`\n  [${config.label}]`);
    try {
      const r = await runQuestion(config, question, system);
      console.log(`  tools: ${r.toolsUsed.join(", ") || "none"} | rounds: ${r.rounds}`);
      console.log(`  ${r.finalText.replace(/\n+/g, " ") || "(EMPTY)"}`);
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

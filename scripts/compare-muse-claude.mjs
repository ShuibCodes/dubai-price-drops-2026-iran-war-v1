#!/usr/bin/env node
/**
 * Compare the Whautomate auto-reply on Claude vs Meta's Muse Spark.
 *
 * Sends the same made-up WhatsApp threads, with the real DEFAULT_REPLY_PROMPT,
 * to Claude and to Muse (through Muse's Anthropic-compatible Messages API and
 * its OpenAI-style API) and prints each reply with its token use, latency and
 * cost. No Supabase, no WhatsApp sends — read-only apart from the model APIs.
 *
 * Usage:
 *   node scripts/compare-muse-claude.mjs
 *
 * Requires in .env.local: ANTHROPIC_API_KEY, MODEL_API_KEY (Meta Model API).
 */
import fs from "fs";
import path from "path";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

for (const key of ["ANTHROPIC_API_KEY", "MODEL_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env.local`);
    process.exit(1);
  }
}

// Read the prompt from the source instead of importing autoreply.js, which
// pulls in modules plain Node can't resolve (directory imports).
function readDefaultReplyPrompt() {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/lib/whautomate/autoreply.js"),
    "utf8"
  );
  const match = source.match(/export const DEFAULT_REPLY_PROMPT = `([\s\S]*?)`;/);
  if (!match) throw new Error("DEFAULT_REPLY_PROMPT not found in autoreply.js");
  return match[1];
}

// Same post-processing as generateReply() (cleanupFormatting + limitWords in
// src/lib/kb/engine.js).
function toWhatsappReply(rawText) {
  const clean = String(rawText || "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 75) return words.join(" ");
  return `${words.slice(0, 75).join(" ")}...`;
}

// USD per million tokens. Muse bills thinking tokens as output.
const PRICES = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "muse-spark-1.3": { input: 1.25, output: 4.25 },
};

const CONFIGS = [
  {
    label: "Claude Sonnet 4.6 (live today)",
    url: "https://api.anthropic.com/v1/messages",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY },
    body: { model: "claude-sonnet-4-6", max_tokens: 320 },
  },
  {
    label: "Muse, straight swap (same settings)",
    url: "https://api.meta.ai/v1/messages",
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
    body: { model: "muse-spark-1.3", max_tokens: 320 },
  },
  {
    label: "Muse, low effort + room to think",
    url: "https://api.meta.ai/v1/messages",
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
    body: {
      model: "muse-spark-1.3",
      max_tokens: 2048,
      output_config: { effort: "low" },
    },
  },
  // "minimal" effort is only accepted on the OpenAI-style endpoint; the
  // Messages API stops at "low". Muse can't turn thinking off entirely.
  {
    label: "Muse, minimal effort (OpenAI-style API)",
    format: "openai",
    url: "https://api.meta.ai/v1/chat/completions",
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
    body: {
      model: "muse-spark-1.3",
      max_tokens: 2048,
      reasoning_effort: "minimal",
    },
  },
];

// Made-up leads only — never paste real client chats in here.
const THREADS = [
  {
    name: "English, first message",
    messages: [
      { role: "user", content: "Hi, I saw your ad. Looking for a 2 bed in Dubai Marina" },
    ],
  },
  {
    name: "Arabic",
    messages: [
      {
        role: "user",
        content: "مرحبا، أبحث عن شقة للاستثمار في دبي، ميزانيتي حوالي مليون درهم",
      },
    ],
  },
  {
    name: "Arabizi",
    messages: [{ role: "user", content: "salam, kam si3r studio fi business bay?" }],
  },
  {
    name: "Asks for a specific deal (must not invent listings)",
    messages: [
      { role: "user", content: "Hello, interested in buying in JVC" },
      {
        role: "assistant",
        content:
          "Great choice, JVC has some strong value right now. Roughly what budget are you working with in dirhams?",
      },
      {
        role: "user",
        content:
          "Around 1.5M AED, ready to buy this month. What's the best deal you have in JVC right now?",
      },
    ],
  },
  {
    name: "Wants a human (expects [[HANDOFF]])",
    messages: [
      { role: "user", content: "Can I just speak to an agent please? Call me" },
    ],
  },
  {
    name: "Sceptical lead",
    messages: [
      {
        role: "user",
        content:
          "Is this a bot? Prices are dropping because of the war, why would I buy now?",
      },
    ],
  },
];

const systemPrompt = readDefaultReplyPrompt();

function buildRequestBody(config, messages) {
  if (config.format === "openai") {
    return {
      ...config.body,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    };
  }
  return { ...config.body, system: systemPrompt, messages };
}

function parseResponse(config, body) {
  if (config.format === "openai") {
    const choice = body.choices?.[0] || {};
    const usage = body.usage || {};
    return {
      rawText: String(choice.message?.content || "").trim(),
      stopReason: choice.finish_reason,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      thinkingTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
    };
  }
  const usage = body.usage || {};
  return {
    rawText: (body.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim(),
    stopReason: body.stop_reason,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    thinkingTokens: usage.output_tokens_details?.thinking_tokens || 0,
  };
}

async function runOne(config, messages) {
  const started = Date.now();
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        ...config.headers,
        ...(config.format === "openai" ? {} : { "anthropic-version": "2023-06-01" }),
        "content-type": "application/json",
      },
      body: JSON.stringify(buildRequestBody(config, messages)),
    });
    const body = await response.json().catch(() => ({}));
    const ms = Date.now() - started;
    if (!response.ok) {
      return { ms, error: body?.error?.message || `HTTP ${response.status}` };
    }

    const parsed = parseResponse(config, body);
    const price = PRICES[config.body.model];
    const cost =
      (parsed.inputTokens * price.input + parsed.outputTokens * price.output) / 1e6;

    return {
      ms,
      reply: toWhatsappReply(parsed.rawText),
      handoff: /\[\[HANDOFF\]\]/i.test(parsed.rawText),
      stopReason: parsed.stopReason,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      thinkingTokens: parsed.thinkingTokens,
      cost,
    };
  } catch (error) {
    return { ms: Date.now() - started, error: error.message };
  }
}

const totals = CONFIGS.map(() => ({ cost: 0, empty: 0, ms: 0, count: 0 }));

for (const thread of THREADS) {
  console.log(`\n=== ${thread.name} ===`);
  console.log(`Lead: ${thread.messages[thread.messages.length - 1].content}`);

  for (const [i, config] of CONFIGS.entries()) {
    const result = await runOne(config, thread.messages);
    console.log(`\n  [${config.label}]`);
    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
      totals[i].empty += 1;
      continue;
    }
    console.log(`  ${result.reply || "(EMPTY REPLY)"}`);
    console.log(
      `  stop=${result.stopReason} handoff=${result.handoff} ` +
        `in=${result.inputTokens} out=${result.outputTokens} ` +
        `(thinking ${result.thinkingTokens}) ${result.ms}ms $${result.cost.toFixed(5)}`
    );
    totals[i].cost += result.cost;
    totals[i].ms += result.ms;
    totals[i].count += 1;
    if (!result.reply) totals[i].empty += 1;
  }
}

console.log("\n=== Summary ===");
for (const [i, config] of CONFIGS.entries()) {
  const t = totals[i];
  const avgCost = t.count ? t.cost / t.count : 0;
  const avgMs = t.count ? Math.round(t.ms / t.count) : 0;
  console.log(
    `${config.label}: avg $${avgCost.toFixed(5)}/reply ` +
      `(~$${(avgCost * 1000).toFixed(2)} per 1,000), avg ${avgMs}ms, ` +
      `${t.empty}/${THREADS.length} empty or failed`
  );
}

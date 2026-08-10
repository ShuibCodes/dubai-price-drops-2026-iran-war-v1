import Anthropic from "@anthropic-ai/sdk";
import { JARVIS_LEADS_TABLE } from "@/lib/ingest/jarvis-ingest";
import { formatJarvisLeadName } from "@/lib/jarvis/infer-name";
import { getSupabaseServerClient, MESSAGES_TABLE } from "@/lib/supabase/server";

/** Cheap yes/no classifier — escalate to Sonnet only if Haiku quality proves weak. */
const MODEL = "claude-haiku-4-5";

/** Default lookback when the user does not specify a window. */
export const BATCH_CALLBACK_DEFAULT_WINDOW_DAYS = 21;
/** Max matched contacts returned / collected. */
export const BATCH_CALLBACK_MATCH_LIMIT = 50;
/**
 * Hard cap on threads sent to Claude per search (newest activity first).
 * Typical Sterling 21-day window is ~100 threads — this covers that with headroom.
 */
export const BATCH_CALLBACK_MAX_THREADS_EVALUATED = 120;
/** Recent messages kept per thread for the Claude prompt. */
export const BATCH_CALLBACK_MESSAGES_PER_THREAD = 20;
/** Threads judged per Claude request (one JSON array response). */
export const BATCH_CALLBACK_CLAUDE_BATCH_SIZE = 8;
/** Parallel Claude batch requests. */
export const BATCH_CALLBACK_CLAUDE_CONCURRENCY = 3;

const MATCH_SYSTEM = `You classify WhatsApp threads against a user's intent for a batch callback list.

The intent is a DESCRIPTION of the kind of conversation, not a literal keyword.
Match semantically — e.g. "mentioned a budget" matches "what's my max spend" or "I can go up to 2M".
Match if EITHER side (inbound contact OR outbound owner) expressed the idea.

Return ONLY a JSON array (no markdown), one object per threadId you were given:
[{"threadId":"<uuid>","match":true|false,"reason":"<one short line>"}]

Rules:
- reason must be one line, max ~120 chars, concrete (quote or paraphrase the signal).
- If unsure, match=false.
- Include every threadId exactly once.`;

function db() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

function fullPhone(waId) {
  const digits = String(waId || "").replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function bodyLine(row) {
  const text = String(row.body || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 400);
  return `[${row.msg_type || "message"}]`;
}

function formatThreadForPrompt(thread) {
  const lines = thread.messages.map((m) => {
    const when = String(m.timestamp || "").slice(0, 16).replace("T", " ");
    const dir = m.direction === "inbound" ? "INBOUND" : "OUTBOUND";
    return `[${when}] ${dir}: ${bodyLine(m)}`;
  });
  return `threadId=${thread.jarvisLeadId}\n${lines.join("\n")}`;
}

/**
 * Parse a natural-language batch-callback command into intent + windowDays.
 * Does not dial or search — pure text parse.
 *
 * @param {string} text
 * @returns {{ intent: string, windowDays: number, raw: string }}
 */
export function parseBatchCallbackCommand(text) {
  const raw = String(text || "").trim();
  let intent = raw;
  let windowDays = BATCH_CALLBACK_DEFAULT_WINDOW_DAYS;

  const windowPatterns = [
    {
      re: /\b(?:in|over|from|during|within|for)?\s*(?:the\s+)?last\s+(\d+)\s*(day|days|week|weeks|month|months)\b/i,
      apply: (n, unit) => {
        const u = unit.toLowerCase();
        if (u.startsWith("day")) return n;
        if (u.startsWith("week")) return n * 7;
        return n * 30;
      },
    },
    {
      re: /\b(?:in|over|from|during|within|for)?\s*(?:the\s+)?past\s+(\d+)\s*(day|days|week|weeks|month|months)\b/i,
      apply: (n, unit) => {
        const u = unit.toLowerCase();
        if (u.startsWith("day")) return n;
        if (u.startsWith("week")) return n * 7;
        return n * 30;
      },
    },
    {
      re: /\b(?:in|over|during)\s*(?:the\s+)?last\s+(week|month|year)\b/i,
      apply: (_n, unit) => {
        const u = String(unit).toLowerCase();
        if (u === "week") return 7;
        if (u === "month") return 30;
        return 365;
      },
    },
  ];

  for (const pattern of windowPatterns) {
    const match = intent.match(pattern.re);
    if (!match) continue;
    if (match[2]) {
      windowDays = pattern.apply(Number(match[1]), match[2]);
    } else {
      windowDays = pattern.apply(1, match[1]);
    }
    intent = intent.replace(pattern.re, " ").replace(/\s+/g, " ").trim();
    break;
  }

  intent = intent
    .replace(
      /^(?:please\s+)?(?:can you\s+)?(?:call|ring|dial|text|message|find|list|get|show)\s+/i,
      ""
    )
    .replace(
      /^(?:everyone|anybody|anyone|people|contacts|leads|them)\s+(?:who|that|whom)\s+/i,
      ""
    )
    .replace(/^(?:everyone|anybody|anyone|people|contacts|leads)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!intent) intent = raw;

  windowDays = clampInt(windowDays, {
    min: 1,
    max: 366,
    fallback: BATCH_CALLBACK_DEFAULT_WINDOW_DAYS,
  });

  return { intent, windowDays, raw };
}

async function loadActiveThreads({
  tenantId,
  windowDays,
  maxThreads,
  messagesPerThread,
}) {
  const supabase = db();
  const since = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  // One bounded pull, group in memory — ~2k rows for a typical 21d Sterling window.
  const { data, error } = await supabase
    .from(MESSAGES_TABLE)
    .select("id, jarvis_lead_id, direction, body, msg_type, timestamp")
    .eq("tenant_id", tenantId)
    .not("jarvis_lead_id", "is", null)
    .gte("timestamp", since)
    .order("timestamp", { ascending: false })
    .limit(8000);
  if (error) {
    throw new Error(`Batch callback message prefilter failed: ${error.message}`);
  }

  const byLead = new Map();
  for (const row of data || []) {
    const leadId = row.jarvis_lead_id;
    if (!leadId) continue;
    let bucket = byLead.get(leadId);
    if (!bucket) {
      bucket = {
        jarvisLeadId: leadId,
        lastMessageAt: row.timestamp,
        messagesNewestFirst: [],
      };
      byLead.set(leadId, bucket);
    }
    if (bucket.messagesNewestFirst.length < messagesPerThread) {
      bucket.messagesNewestFirst.push(row);
    }
  }

  const threads = [...byLead.values()]
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    )
    .slice(0, maxThreads)
    .map((t) => ({
      jarvisLeadId: t.jarvisLeadId,
      lastMessageAt: t.lastMessageAt,
      // Chronological for the model
      messages: [...t.messagesNewestFirst].reverse(),
    }));

  return { since, threads, scannedMessageRows: (data || []).length };
}

async function loadLeadsById(tenantId, leadIds) {
  if (!leadIds.length) return new Map();
  const supabase = db();
  const { data, error } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .select(
      "id, wa_id, push_name, inferred_name, inferred_name_confidence, inferred_name_at"
    )
    .eq("tenant_id", tenantId)
    .in("id", leadIds);
  if (error) throw new Error(`Jarvis leads lookup failed: ${error.message}`);
  return new Map((data || []).map((row) => [row.id, row]));
}

function parseMatchArray(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("Claude match response was not a JSON array");
  }
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("Claude match response JSON was not an array");
  }
  return parsed;
}

async function judgeThreadBatch({ client, intent, threads }) {
  if (!threads.length) return [];

  const userPrompt = `Intent: ${intent}

Threads:
${threads.map((t, i) => `--- Thread ${i + 1} ---\n${formatThreadForPrompt(t)}`).join("\n\n")}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: MATCH_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const judgments = parseMatchArray(text);
  const byId = new Map(
    judgments.map((j) => [String(j.threadId || j.jarvis_lead_id || ""), j])
  );

  return threads.map((thread) => {
    const hit = byId.get(thread.jarvisLeadId);
    const match = Boolean(hit?.match);
    const reason = String(hit?.reason || (match ? "matched" : "no match"))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    return {
      jarvisLeadId: thread.jarvisLeadId,
      match,
      reason,
      lastMessageAt: thread.lastMessageAt,
    };
  });
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run()
  );
  await Promise.all(runners);
  return results;
}

/**
 * Semantic / intent-based candidate search for Jarvis batch callbacks.
 * Standalone — not wired to WhatsApp confirm flow yet.
 *
 * @param {{
 *   tenantId: string,
 *   intent: string,
 *   windowDays?: number,
 *   limit?: number,
 *   maxThreadsEvaluated?: number,
 *   onProgress?: (info: object) => void,
 * }} args
 */
export async function searchBatchCallbackCandidates({
  tenantId,
  intent,
  windowDays = BATCH_CALLBACK_DEFAULT_WINDOW_DAYS,
  limit = BATCH_CALLBACK_MATCH_LIMIT,
  maxThreadsEvaluated = BATCH_CALLBACK_MAX_THREADS_EVALUATED,
  onProgress,
} = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!tenantId) throw new Error("tenantId is required");

  const cleanedIntent = String(intent || "").trim();
  if (!cleanedIntent) throw new Error("intent is required");

  const days = clampInt(windowDays, {
    min: 1,
    max: 366,
    fallback: BATCH_CALLBACK_DEFAULT_WINDOW_DAYS,
  });
  const matchLimit = clampInt(limit, {
    min: 1,
    max: BATCH_CALLBACK_MATCH_LIMIT,
    fallback: BATCH_CALLBACK_MATCH_LIMIT,
  });
  const threadCap = clampInt(maxThreadsEvaluated, {
    min: 1,
    max: 300,
    fallback: BATCH_CALLBACK_MAX_THREADS_EVALUATED,
  });

  const { since, threads, scannedMessageRows } = await loadActiveThreads({
    tenantId,
    windowDays: days,
    maxThreads: threadCap,
    messagesPerThread: BATCH_CALLBACK_MESSAGES_PER_THREAD,
  });

  onProgress?.({
    phase: "prefilter",
    since,
    activeThreads: threads.length,
    scannedMessageRows,
    threadCap,
  });

  if (!threads.length) {
    return {
      intent: cleanedIntent,
      windowDays: days,
      since,
      scannedMessageRows,
      threadsConsidered: 0,
      threadsEvaluated: 0,
      matches: [],
      model: MODEL,
    };
  }

  const client = new Anthropic({ apiKey });
  const batches = [];
  for (let i = 0; i < threads.length; i += BATCH_CALLBACK_CLAUDE_BATCH_SIZE) {
    batches.push(threads.slice(i, i + BATCH_CALLBACK_CLAUDE_BATCH_SIZE));
  }

  const matches = [];
  let threadsEvaluated = 0;
  let stop = false;

  // Process in waves of CONCURRENCY so we can stop once we have enough matches.
  for (
    let waveStart = 0;
    waveStart < batches.length && !stop;
    waveStart += BATCH_CALLBACK_CLAUDE_CONCURRENCY
  ) {
    const wave = batches.slice(
      waveStart,
      waveStart + BATCH_CALLBACK_CLAUDE_CONCURRENCY
    );
    const waveResults = await mapPool(
      wave,
      BATCH_CALLBACK_CLAUDE_CONCURRENCY,
      async (batch) => judgeThreadBatch({ client, intent: cleanedIntent, threads: batch })
    );

    for (const judgments of waveResults) {
      for (const judgment of judgments) {
        threadsEvaluated += 1;
        if (!judgment.match) continue;
        if (matches.length >= matchLimit) {
          stop = true;
          break;
        }
        matches.push(judgment);
      }
      if (matches.length >= matchLimit) {
        stop = true;
        break;
      }
    }

    onProgress?.({
      phase: "evaluating",
      threadsEvaluated,
      matchCount: matches.length,
      batchesDone: Math.min(
        waveStart + wave.length,
        batches.length
      ),
      batchesTotal: batches.length,
    });
  }

  const leadMap = await loadLeadsById(
    tenantId,
    matches.map((m) => m.jarvisLeadId)
  );

  const enriched = matches.map((m) => {
    const lead = leadMap.get(m.jarvisLeadId);
    const { displayName, nameSource, nameConfidence } = formatJarvisLeadName(
      lead || {}
    );
    return {
      jarvis_lead_id: m.jarvisLeadId,
      display_name: displayName,
      name_source: nameSource,
      name_confidence: nameConfidence,
      phone_e164: fullPhone(lead?.wa_id),
      wa_id: lead?.wa_id || null,
      last_message_at: m.lastMessageAt,
      match_reason: m.reason,
    };
  });

  return {
    intent: cleanedIntent,
    windowDays: days,
    since,
    scannedMessageRows,
    threadsConsidered: threads.length,
    threadsEvaluated,
    matchLimit,
    matches: enriched,
    model: MODEL,
    stoppedEarly: stop && matches.length >= matchLimit,
  };
}

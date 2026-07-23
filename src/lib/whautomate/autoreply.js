import { cleanupFormatting, limitWords } from "@/lib/kb/engine";
import { insertMessageIfNew } from "@/lib/ingest/message-ingest";
import { MESSAGES_TABLE } from "@/lib/supabase/server";
import { sendWhautomateText } from "@/lib/whautomate/send";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEBOUNCE_MS = 60 * 1000;
const HUMAN_ACTIVE_MS = 10 * 60 * 1000;
const BOT_PAUSE_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_REPLY_PROMPT = `You are a warm, personable WhatsApp assistant for Fourteen Sixteen (1416) Real Estate in Dubai.

Goals:
- Answer simply and conversationally.
- Qualify gently over chat: if they found the perfect property at the right price — would they invest or live in it? Ask about budget in dirhams, preferred areas, and timing — one question at a time.
- Mention we have access to below-market distressed deals when relevant.
- Note that a consultant will follow up.

Rules:
- Keep replies to 75 words or fewer.
- At most one question per message.
- Never invent specific listings, prices, or inventory.
- Never parrot the lead's previous answers back at them.
- If you are unsure, or they ask for a human / agent / call / to speak to someone: say a team member will follow up shortly, and end with the exact token [[HANDOFF]].`;

function wantsHandoff(text) {
  return /\[\[HANDOFF\]\]/i.test(String(text || ""));
}

function stripHandoffToken(text) {
  return String(text || "")
    .replace(/\[\[HANDOFF\]\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isAutoreplyGloballyEnabled() {
  return String(process.env.WHAUTOMATE_AUTOREPLY || "").toLowerCase() === "true";
}

async function hasRecentHumanOutbound(supabase, leadId) {
  const since = new Date(Date.now() - HUMAN_ACTIVE_MS).toISOString();
  const { data } = await supabase
    .from(MESSAGES_TABLE)
    .select("id")
    .eq("lead_id", leadId)
    .eq("direction", "outbound")
    .eq("sent_by_bot", false)
    .gte("timestamp", since)
    .limit(1);
  return Boolean(data?.length);
}

async function hasRecentBotReply(supabase, leadId) {
  const since = new Date(Date.now() - DEBOUNCE_MS).toISOString();
  const { data } = await supabase
    .from(MESSAGES_TABLE)
    .select("id")
    .eq("lead_id", leadId)
    .eq("direction", "outbound")
    .eq("sent_by_bot", true)
    .gte("timestamp", since)
    .limit(1);
  return Boolean(data?.length);
}

async function loadThreadMessages(supabase, leadId, limit = 20) {
  const { data } = await supabase
    .from(MESSAGES_TABLE)
    .select("direction, body, timestamp")
    .eq("lead_id", leadId)
    .order("timestamp", { ascending: false })
    .limit(limit);

  return (data || []).reverse();
}

function threadToAnthropicMessages(rows) {
  const out = [];
  for (const row of rows) {
    const content = String(row.body || "").trim();
    if (!content) continue;
    const role = row.direction === "inbound" ? "user" : "assistant";
    // Merge consecutive same-role turns
    if (out.length && out[out.length - 1].role === role) {
      out[out.length - 1].content += `\n${content}`;
    } else {
      out.push({ role, content });
    }
  }
  // Anthropic requires first message to be user
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function generateReply({ systemPrompt, messages }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 320,
      system: systemPrompt,
      messages,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `Anthropic error ${response.status}`);
  }

  const rawText = (body.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  return limitWords(cleanupFormatting(rawText), 75);
}

async function pauseBot(supabase, leadId) {
  const until = new Date(Date.now() + BOT_PAUSE_MS).toISOString();
  await supabase.from("leads").update({ bot_paused_until: until }).eq("id", leadId);
  return until;
}

/**
 * Fire-and-forget auto-reply for an inbound Whautomate message.
 * All kill switches default OFF / safe.
 */
export async function maybeAutoReply({ supabase, tenant, lead, inboundBody }) {
  if (!isAutoreplyGloballyEnabled()) {
    return { skipped: true, reason: "global_off" };
  }
  if (!tenant?.autoreply_enabled) {
    return { skipped: true, reason: "tenant_off" };
  }
  if (!lead?.id) {
    return { skipped: true, reason: "no_lead" };
  }

  if (lead.bot_paused_until) {
    const pausedUntil = new Date(lead.bot_paused_until);
    if (!Number.isNaN(pausedUntil.getTime()) && pausedUntil.getTime() > Date.now()) {
      return { skipped: true, reason: "lead_paused" };
    }
  }

  if (await hasRecentHumanOutbound(supabase, lead.id)) {
    return { skipped: true, reason: "human_active" };
  }

  if (await hasRecentBotReply(supabase, lead.id)) {
    return { skipped: true, reason: "debounce" };
  }

  const thread = await loadThreadMessages(supabase, lead.id);
  const messages = threadToAnthropicMessages(thread);
  if (!messages.length) {
    // Ensure at least the inbound we just got
    const fallback = String(inboundBody || "").trim();
    if (!fallback) return { skipped: true, reason: "empty_thread" };
    messages.push({ role: "user", content: fallback });
  }

  const systemPrompt = String(tenant.reply_prompt || "").trim() || DEFAULT_REPLY_PROMPT;
  const rawReply = await generateReply({ systemPrompt, messages });
  const handoff = wantsHandoff(rawReply);
  const replyText = stripHandoffToken(rawReply);
  if (!replyText) {
    return { skipped: true, reason: "empty_reply" };
  }

  if (handoff) {
    await pauseBot(supabase, lead.id);
  }

  const sendResult = await sendWhautomateText({
    contactId: lead.whautomate_contact_id,
    phoneNumber: lead.wa_id,
    name: lead.push_name,
    text: replyText,
  });

  if (!sendResult.ok) {
    return { skipped: false, sent: false, reason: "send_failed", raw: sendResult.raw };
  }

  const waMessageId = `bot-${lead.id}-${Date.now()}`;
  await insertMessageIfNew({
    supabase,
    tenantId: tenant.id,
    leadId: lead.id,
    waMessageId,
    direction: "outbound",
    body: replyText,
    msgType: "text",
    mediaId: null,
    timestamp: new Date().toISOString(),
    raw: { source: "whautomate-bot", send: sendResult.raw },
    sentByBot: true,
  });

  return { skipped: false, sent: true, handoff, waMessageId };
}

/** Schedule reply without blocking the webhook HTTP response. */
export function scheduleAutoReply(ctx) {
  setTimeout(() => {
    maybeAutoReply(ctx).catch((error) => {
      console.error("[whautomate/autoreply]", error.message);
    });
  }, 0);
}

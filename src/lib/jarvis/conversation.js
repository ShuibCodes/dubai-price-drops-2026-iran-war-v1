import { randomUUID } from "node:crypto";
import { assertJarvisActor } from "@/lib/jarvis/visibility";
import { normalizeSenderPhone } from "@/lib/jarvis/pending-relay";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const JARVIS_CONVERSATION_TABLE = "jarvis_conversation_messages";
// POST /api/whatsapp sets maxDuration = 90. This lease is that limit plus 60
// seconds, so a live invocation cannot outlive its lease when every extension
// fails. A crashed process stops extending and the row expires on its own.
export const JARVIS_ROUTE_MAX_DURATION_SECONDS = 90;
export const JARVIS_CONVERSATION_LEASE_SECONDS =
  JARVIS_ROUTE_MAX_DURATION_SECONDS + 60;
const LEASE_SECONDS = JARVIS_CONVERSATION_LEASE_SECONDS;
const EXTEND_EVERY_MS = 20_000;
const DEFAULT_WAIT_MS = 90_000;
const DEFAULT_POLL_MS = 200;
const HISTORY_LIMIT = 30;
const BODY_MAX = 8000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clientOf(supabase) {
  const db = supabase || getSupabaseServerClient();
  if (!db) throw new Error("Supabase is not configured");
  return db;
}

function scopeOf({ tenantId, agentId, senderPhone }) {
  assertJarvisActor({ tenantId, agentId });
  const phone = normalizeSenderPhone(senderPhone);
  if (!phone) throw new Error("senderPhone is required");
  return { tenantId, agentId, senderPhone: phone };
}

function clipBody(text) {
  const body = String(text || "").trim();
  if (!body) throw new Error("Conversation text is empty");
  return body.slice(0, BODY_MAX);
}

function isUniqueViolation(error) {
  return error?.code === "23505";
}

async function rpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

async function acquireLease(supabase, scope, token, { waitMs, pollMs }) {
  const deadline = Date.now() + waitMs;
  const args = {
    p_tenant_id: scope.tenantId,
    p_agent_id: scope.agentId,
    p_sender_phone: scope.senderPhone,
    p_lock_token: token,
    p_lease_seconds: LEASE_SECONDS,
  };
  for (;;) {
    const acquired = await rpc(supabase, "acquire_jarvis_conversation_lock", args);
    if (acquired) return token;
    if (Date.now() + pollMs > deadline) {
      throw new Error("Conversation is busy. Please try again in a moment.");
    }
    await sleep(pollMs);
  }
}

async function extendLease(supabase, scope, token) {
  const extended = await rpc(supabase, "extend_jarvis_conversation_lock", {
    p_tenant_id: scope.tenantId,
    p_agent_id: scope.agentId,
    p_sender_phone: scope.senderPhone,
    p_lock_token: token,
    p_lease_seconds: LEASE_SECONDS,
  });
  return Boolean(extended);
}

async function releaseLease(supabase, scope, token) {
  await rpc(supabase, "release_jarvis_conversation_lock", {
    p_tenant_id: scope.tenantId,
    p_agent_id: scope.agentId,
    p_sender_phone: scope.senderPhone,
    p_lock_token: token,
  });
}

function scoped(query, scope) {
  return query
    .eq("tenant_id", scope.tenantId)
    .eq("agent_id", scope.agentId)
    .eq("sender_phone", scope.senderPhone);
}

async function loadHistory(supabase, scope) {
  const { data, error } = await scoped(
    supabase
      .from(JARVIS_CONVERSATION_TABLE)
      .select("role, body, seq"),
    scope
  )
    .order("seq", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(`Conversation load failed: ${error.message}`);
  return (data || [])
    .slice()
    .reverse()
    .map((row) => ({ role: row.role, content: row.body }));
}

async function findUserBySid(supabase, scope, messageSid) {
  const { data, error } = await scoped(
    supabase
      .from(JARVIS_CONVERSATION_TABLE)
      .select("id, turn_id, body")
      .eq("role", "user")
      .eq("message_sid", messageSid),
    scope
  ).maybeSingle();
  if (error) throw new Error(`Conversation sid lookup failed: ${error.message}`);
  return data || null;
}

async function findAssistant(supabase, scope, turnId) {
  const { data, error } = await scoped(
    supabase
      .from(JARVIS_CONVERSATION_TABLE)
      .select("id, body, sent_at")
      .eq("role", "assistant")
      .eq("turn_id", turnId),
    scope
  ).maybeSingle();
  if (error) throw new Error(`Conversation assistant lookup failed: ${error.message}`);
  return data || null;
}

async function insertRow(supabase, row) {
  const { data, error } = await supabase
    .from(JARVIS_CONVERSATION_TABLE)
    .insert(row)
    .select("id, turn_id, body, sent_at")
    .single();
  if (error) {
    if (isUniqueViolation(error)) return { conflict: true };
    throw new Error(`Conversation insert failed: ${error.message}`);
  }
  return { conflict: false, row: data };
}

async function insertAssistantIfOwner(supabase, scope, token, turnId, body) {
  const id = await rpc(supabase, "insert_jarvis_assistant_if_owner", {
    p_tenant_id: scope.tenantId,
    p_agent_id: scope.agentId,
    p_sender_phone: scope.senderPhone,
    p_lock_token: token,
    p_turn_id: turnId,
    p_body: body,
  });
  return id || null;
}

async function findAssistantById(supabase, scope, messageId) {
  const { data, error } = await scoped(
    supabase
      .from(JARVIS_CONVERSATION_TABLE)
      .select("id, body, sent_at")
      .eq("id", messageId)
      .eq("role", "assistant"),
    scope
  ).maybeSingle();
  if (error) throw new Error(`Conversation assistant lookup failed: ${error.message}`);
  return data || null;
}

async function markSentIfOwner(supabase, scope, token, messageId) {
  const marked = await rpc(supabase, "mark_jarvis_assistant_sent_if_owner", {
    p_tenant_id: scope.tenantId,
    p_agent_id: scope.agentId,
    p_sender_phone: scope.senderPhone,
    p_lock_token: token,
    p_message_id: messageId,
  });
  return Boolean(marked);
}

// Ownership is checked immediately before send and again when recording sent_at.
// Those two checks are not one transaction with the WhatsApp request. A lease
// takeover in that gap can let a stale worker send once. A crash after the
// provider accepts and before sent_at is stored can make the next retry send
// the same body again.
async function deliverIfOwner(supabase, scope, token, messageId, body, deliver) {
  const stillOwner = await extendLease(supabase, scope, token);
  if (!stillOwner) return false;
  const saved = await findAssistantById(supabase, scope, messageId);
  if (!saved || saved.sent_at) return false;
  try {
    if (deliver) await deliver(saved.body || body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    console.error("[jarvis] WhatsApp send failed:", message);
    return false;
  }
  try {
    const marked = await markSentIfOwner(supabase, scope, token, messageId);
    if (!marked) {
      console.error("[jarvis] assistant was sent but the sent mark was not stored");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    console.error("[jarvis] assistant sent mark failed:", message);
  }
  return true;
}

/**
 * Serialize one Jarvis WhatsApp turn for a tenant, agent, and sender.
 * The lease is a row, refreshed on a timer. It is not a transaction around
 * the model call. `deliver` runs before the lease is released.
 */
export async function withJarvisConversation({
  supabase,
  tenantId,
  agentId,
  senderPhone,
  messageSid = null,
  userText,
  run,
  deliver,
  waitMs = DEFAULT_WAIT_MS,
  pollMs = DEFAULT_POLL_MS,
}) {
  const db = clientOf(supabase);
  const scope = scopeOf({ tenantId, agentId, senderPhone });
  const sid = String(messageSid || "").trim() || null;
  const token = randomUUID();
  await acquireLease(db, scope, token, { waitMs, pollMs });

  let ownsLease = true;
  const renew = setInterval(() => {
    extendLease(db, scope, token)
      .then((stillOwner) => {
        if (!stillOwner) ownsLease = false;
      })
      .catch((error) => {
        console.error("[jarvis] conversation lease extend failed:", error.message);
      });
  }, EXTEND_EVERY_MS);
  renew.unref?.();

  try {
    let turnId = null;
    if (sid) {
      const existingUser = await findUserBySid(db, scope, sid);
      if (existingUser) {
        turnId = existingUser.turn_id;
        const existingAssistant = await findAssistant(db, scope, turnId);
        if (existingAssistant?.sent_at) {
          return { text: existingAssistant.body, delivered: true, duplicate: true };
        }
        if (existingAssistant) {
          const sent = await deliverIfOwner(
            db,
            scope,
            token,
            existingAssistant.id,
            existingAssistant.body,
            deliver
          );
          return {
            text: existingAssistant.body,
            delivered: sent,
            duplicate: true,
            abandoned: !sent,
          };
        }
      }
    }

    if (!turnId) {
      turnId = randomUUID();
      const inserted = await insertRow(db, {
        tenant_id: scope.tenantId,
        agent_id: scope.agentId,
        sender_phone: scope.senderPhone,
        role: "user",
        body: clipBody(userText),
        message_sid: sid,
        turn_id: turnId,
      });
      if (inserted.conflict) {
        if (!sid) throw new Error("Conversation insert conflict");
        const existingUser = await findUserBySid(db, scope, sid);
        if (!existingUser) throw new Error("Conversation sid conflict without a row");
        turnId = existingUser.turn_id;
        const existingAssistant = await findAssistant(db, scope, turnId);
        if (existingAssistant) {
          if (existingAssistant.sent_at) {
            return { text: existingAssistant.body, delivered: true, duplicate: true };
          }
          const sent = await deliverIfOwner(
            db,
            scope,
            token,
            existingAssistant.id,
            existingAssistant.body,
            deliver
          );
          return {
            text: existingAssistant.body,
            delivered: sent,
            duplicate: true,
            abandoned: !sent,
          };
        }
      }
    }

    const stillHeld = await extendLease(db, scope, token);
    if (!stillHeld) {
      ownsLease = false;
      throw new Error("Conversation lock was lost");
    }

    const messages = await loadHistory(db, scope);
    const reply = clipBody(await run(messages));
    if (!ownsLease) {
      return { text: reply, delivered: false, duplicate: false, abandoned: true };
    }

    const messageId = await insertAssistantIfOwner(db, scope, token, turnId, reply);
    if (!messageId) {
      return { text: reply, delivered: false, duplicate: false, abandoned: true };
    }
    const sent = await deliverIfOwner(db, scope, token, messageId, reply, deliver);
    if (!sent) {
      return { text: reply, delivered: false, duplicate: true, abandoned: true };
    }
    return { text: reply, delivered: true, duplicate: false };
  } finally {
    clearInterval(renew);
    try {
      await releaseLease(db, scope, token);
    } catch (error) {
      console.error("[jarvis] conversation lease release failed:", error.message);
    }
  }
}

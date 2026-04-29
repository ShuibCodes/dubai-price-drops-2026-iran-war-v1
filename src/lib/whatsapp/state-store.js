const STATE_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_MESSAGES = 30;
const MAX_USERS = 500;
const MESSAGE_SID_TTL_MS = 1000 * 60 * 60;

const conversationStore = new Map();
const sidStore = new Map();

function now() {
  return Date.now();
}

function pruneExpired() {
  const cutoff = now() - STATE_TTL_MS;
  for (const [key, value] of conversationStore.entries()) {
    if ((value?.updatedAt ?? 0) < cutoff) {
      conversationStore.delete(key);
    }
  }

  const sidCutoff = now() - MESSAGE_SID_TTL_MS;
  for (const [key, value] of sidStore.entries()) {
    if ((value?.updatedAt ?? 0) < sidCutoff) {
      sidStore.delete(key);
      continue;
    }
    const filtered = (value.sids || []).filter((entry) => entry.ts >= sidCutoff);
    sidStore.set(key, { updatedAt: value.updatedAt, sids: filtered });
  }

  if (conversationStore.size > MAX_USERS) {
    const entries = [...conversationStore.entries()].sort(
      (a, b) => (a[1]?.updatedAt ?? 0) - (b[1]?.updatedAt ?? 0)
    );
    const toDrop = entries.slice(0, conversationStore.size - MAX_USERS);
    for (const [key] of toDrop) {
      conversationStore.delete(key);
    }
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
}

export function getSenderState(sender) {
  pruneExpired();
  const key = String(sender || "").trim();
  if (!key) {
    return {
      messages: [],
      pendingEmailDraft: null,
      pendingCallRequest: null,
      pendingConfirmationExpiry: null,
      updatedAt: now(),
    };
  }
  const existing = conversationStore.get(key);
  if (!existing) {
    return {
      messages: [],
      pendingEmailDraft: null,
      pendingCallRequest: null,
      pendingConfirmationExpiry: null,
      updatedAt: now(),
    };
  }
  return {
    messages: normalizeMessages(existing.messages),
    pendingEmailDraft: existing.pendingEmailDraft ?? null,
    pendingCallRequest: existing.pendingCallRequest ?? null,
    pendingConfirmationExpiry:
      typeof existing.pendingConfirmationExpiry === "number"
        ? existing.pendingConfirmationExpiry
        : null,
    updatedAt: existing.updatedAt ?? now(),
  };
}

export function setSenderState(sender, nextState) {
  const key = String(sender || "").trim();
  if (!key) return;
  pruneExpired();
  conversationStore.set(key, {
    messages: normalizeMessages(nextState?.messages),
    pendingEmailDraft: nextState?.pendingEmailDraft ?? null,
    pendingCallRequest: nextState?.pendingCallRequest ?? null,
    pendingConfirmationExpiry:
      typeof nextState?.pendingConfirmationExpiry === "number"
        ? nextState.pendingConfirmationExpiry
        : null,
    updatedAt: now(),
  });
}

export function hasProcessedMessageSid(sender, messageSid) {
  const key = String(sender || "").trim();
  const sid = String(messageSid || "").trim();
  if (!key || !sid) return false;
  pruneExpired();
  const bucket = sidStore.get(key);
  if (!bucket) return false;
  return (bucket.sids || []).some((entry) => entry.sid === sid);
}

export function markProcessedMessageSid(sender, messageSid) {
  const key = String(sender || "").trim();
  const sid = String(messageSid || "").trim();
  if (!key || !sid) return;
  pruneExpired();
  const existing = sidStore.get(key) ?? { sids: [], updatedAt: now() };
  const next = {
    updatedAt: now(),
    sids: [...(existing.sids || []).filter((entry) => entry.sid !== sid), { sid, ts: now() }].slice(-100),
  };
  sidStore.set(key, next);
}

export function pushConversationTurn(sender, userText, assistantText, priorState = null) {
  const state = priorState ?? getSenderState(sender);
  const nextMessages = [
    ...(state.messages || []),
    { role: "user", content: String(userText || "") },
    { role: "assistant", content: String(assistantText || "") },
  ].slice(-MAX_MESSAGES);
  setSenderState(sender, {
    ...state,
    messages: nextMessages,
  });
}

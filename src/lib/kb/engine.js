import { buildSystemPrompt } from "@/lib/kb/loader";
import { buildEmailDraftFromRequest } from "@/lib/email/draft-workflow";
import { sendLeadEmail } from "@/lib/email/resend-client";
import { fireVapiCall } from "@/lib/vapi";
import { resolveLeadByName } from "@/lib/kb/leads";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const WHATSAPP_REPLY_CHAR_LIMIT = 1200;
const PENDING_CONFIRMATION_TTL_MS = 1000 * 60 * 10;

function cloneState(state = {}) {
  return {
    pendingEmailDraft: state.pendingEmailDraft ?? null,
    pendingCallRequest: state.pendingCallRequest ?? null,
    pendingConfirmationExpiry:
      typeof state.pendingConfirmationExpiry === "number" ? state.pendingConfirmationExpiry : null,
  };
}

export function defaultKbState() {
  return {
    pendingEmailDraft: null,
    pendingCallRequest: null,
    pendingConfirmationExpiry: null,
  };
}

export function limitWords(text, maxWords = 75) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

export function cleanupFormatting(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function trimForWhatsapp(text) {
  const clean = cleanupFormatting(text);
  if (clean.length <= WHATSAPP_REPLY_CHAR_LIMIT) return clean;
  return `${clean.slice(0, WHATSAPP_REPLY_CHAR_LIMIT - 3)}...`;
}

function isAffirmative(text) {
  const normalized = text.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const affirmativePhrases = [
    "yes",
    "yeah",
    "yep",
    "go ahead",
    "do it",
    "please do",
    "sure",
    "ok",
    "okay",
    "confirm",
    "send it",
    "resend",
    "retry",
  ];
  return affirmativePhrases.some((phrase) => normalized.includes(phrase));
}

function extractNameForCall(text) {
  const raw = String(text ?? "");
  const match = raw.match(/\b(?:call|ring|phone)\s+([a-z][a-z\s'-]{1,60})/i);
  if (!match) return null;
  return match[1]
    .replace(/\b(?:to|about|regarding|re|for|and)\b[\s\S]*$/i, "")
    .trim();
}

function parsePendingCallFromAssistantMessage(messageText = "") {
  const text = String(messageText || "");
  const match = text.match(/ready to call\s+(.+?)\s+at\s+([+0-9][0-9+\-\s]{6,})/i);
  if (!match) return null;
  return {
    name: match[1].trim(),
    phone: match[2].trim().replace(/\s+/g, " "),
  };
}

function normalizeMessageHistory(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-30);
}

async function runCommandPath(lastUserMessage, messageHistory, state) {
  const text = String(lastUserMessage || "").trim().toLowerCase();
  const normalized = text.replace(/\s+/g, " ");
  const lastAssistantMessage = [...messageHistory]
    .reverse()
    .find((m) => m?.role === "assistant")?.content;

  const pendingCallFromHistory = parsePendingCallFromAssistantMessage(lastAssistantMessage);
  const isCallIntent =
    normalized.includes("call ") || normalized.startsWith("call") || normalized.includes("ring ");
  const isEmailIntent =
    normalized.includes("email ") ||
    normalized.startsWith("email") ||
    normalized.includes("send an email") ||
    normalized.includes("send email");

  const hasPendingExpiry = typeof state.pendingConfirmationExpiry === "number";
  const hasPendingEmailApproval = Boolean(state.pendingEmailDraft) && hasPendingExpiry;
  const hasPendingCallApproval =
    (Boolean(state.pendingCallRequest) && hasPendingExpiry) ||
    (Boolean(pendingCallFromHistory) && hasPendingExpiry);
  const hasPendingAction = hasPendingEmailApproval || hasPendingCallApproval;
  const isPendingExpired =
    hasPendingAction &&
    hasPendingExpiry &&
    Date.now() > state.pendingConfirmationExpiry;
  const wantsToSendCall = isAffirmative(normalized) && hasPendingCallApproval;
  const wantsToSendEmail = isAffirmative(normalized) && hasPendingEmailApproval;
  const wantsToCancel =
    (hasPendingEmailApproval || hasPendingCallApproval) &&
    (normalized.includes("cancel") || normalized.includes("stop") || normalized.includes("no"));

  if ((wantsToSendCall || wantsToSendEmail) && isPendingExpired) {
    return {
      handled: true,
      text: "Your previous action request expired. What would you like to do?",
      nextState: {
        ...state,
        pendingEmailDraft: null,
        pendingCallRequest: null,
        pendingConfirmationExpiry: null,
      },
    };
  }

  if (wantsToCancel) {
    return {
      handled: true,
      text: "Pending action cancelled.",
      nextState: {
        ...state,
        pendingEmailDraft: null,
        pendingCallRequest: null,
        pendingConfirmationExpiry: null,
      },
    };
  }

  if (wantsToSendCall) {
    try {
      let callLead = state.pendingCallRequest;
      if (!callLead && pendingCallFromHistory) {
        callLead = { ...pendingCallFromHistory, area: "Dubai" };
      }
      const result = await fireVapiCall({
        overridePhone: callLead.phone,
        listing: {
          area: callLead.area || "Dubai",
          title: "follow-up listing update",
          price: null,
          type: "property",
          bedrooms: null,
          agentName: "Alex",
        },
      });

      return {
        handled: true,
        text: `Calling ${callLead.name} now at ${callLead.phone}. Call ID: ${result?.id || "pending"}.`,
        nextState: {
          ...state,
          pendingCallRequest: null,
          pendingConfirmationExpiry: null,
        },
      };
    } catch (error) {
      return {
        handled: true,
        text: `I could not place the call yet. ${error.message}`,
        nextState: state,
      };
    }
  }

  if (wantsToSendEmail) {
    try {
      const sentTo = state.pendingEmailDraft.to;
      await sendLeadEmail({
        to: sentTo,
        subject: state.pendingEmailDraft.subject,
        text: state.pendingEmailDraft.body,
        metadata: {
          leadName: state.pendingEmailDraft.leadName,
          listingArea: state.pendingEmailDraft.variables?.listing_area,
          transcriptSource: state.pendingEmailDraft.transcriptSource,
        },
      });

      return {
        handled: true,
        text: `Email sent to ${sentTo}.`,
        nextState: {
          ...state,
          pendingEmailDraft: null,
          pendingConfirmationExpiry: null,
        },
      };
    } catch (error) {
      return {
        handled: true,
        text: `I could not send the email yet. ${error.message}`,
        nextState: state,
      };
    }
  }

  if (isCallIntent) {
    const targetName = extractNameForCall(lastUserMessage);
    if (!targetName) {
      return {
        handled: true,
        text: "Who should I call? Say call followed by the lead name.",
        nextState: state,
      };
    }

    const { matches } = resolveLeadByName(targetName);
    if (!matches.length) {
      return {
        handled: true,
        text: `I could not find a lead named ${targetName}. Please check the name and try again.`,
        nextState: state,
      };
    }
    if (matches.length > 1) {
      const options = matches
        .slice(0, 3)
        .map((lead) => `${lead.name} (${lead.phone})`)
        .join(", ");
      return {
        handled: true,
        text: `I found multiple leads for ${targetName}: ${options}. Which one should I call?`,
        nextState: state,
      };
    }

    const lead = matches[0];
    return {
      handled: true,
      text: `Ready to call ${lead.name} at ${lead.phone}. Should I place the call now?`,
      nextState: {
        ...state,
        pendingCallRequest: lead,
        pendingConfirmationExpiry: Date.now() + PENDING_CONFIRMATION_TTL_MS,
      },
    };
  }

  if (isEmailIntent) {
    try {
      const draft = await buildEmailDraftFromRequest(lastUserMessage);
      if (!draft.to) {
        return {
          handled: true,
          text: "I drafted the email but could not find a recipient email in the transcript. Add an email in the lead context first.",
          nextState: {
            ...state,
            pendingEmailDraft: null,
          },
        };
      }

      return {
        handled: true,
        text: `Draft ready for ${draft.to}. Subject: ${draft.subject}. ${draft.body} Should I send this email now?`,
        nextState: {
          ...state,
          pendingEmailDraft: draft,
          pendingConfirmationExpiry: Date.now() + PENDING_CONFIRMATION_TTL_MS,
        },
      };
    } catch (error) {
      return {
        handled: true,
        text: `I couldn't prepare the email draft. ${error.message}`,
        nextState: state,
      };
    }
  }

  return { handled: false, nextState: state, text: null };
}

async function runLlmPath(messages) {
  const prompt = buildSystemPrompt();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const normalizedMessages = messages.map((m, idx) => {
    const isLast = idx === messages.length - 1;
    if (isLast && m.role === "user") {
      return {
        role: m.role,
        content: `${m.content}\n\nOutput constraints: 30-75 words only. Lead with recommendation first. Do not include sources. Use FirstName + last initial only (example: Tariq H.). Include recency in brackets. Always include WhatsApp number when available. End with one short question if useful.`,
      };
    }
    return { role: m.role, content: m.content };
  });

  const completionResponse = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 320,
      system: prompt,
      messages: normalizedMessages,
    }),
  });

  const completion = await completionResponse.json();
  if (!completionResponse.ok) {
    throw new Error(completion?.error?.message || "Anthropic request failed");
  }

  const rawText = (completion.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  return limitWords(cleanupFormatting(rawText), 75);
}

export async function runKbTurn({ messages, state }) {
  const nextState = cloneState(state ?? defaultKbState());
  const history = normalizeMessageHistory(messages);
  const lastUserMessage = [...history].reverse().find((m) => m.role === "user")?.content;

  if (!lastUserMessage) {
    return {
      text: "I need a message to continue.",
      nextState,
      source: "system",
    };
  }

  const commandResult = await runCommandPath(lastUserMessage, history, nextState);
  if (commandResult.handled) {
    return {
      text: trimForWhatsapp(limitWords(cleanupFormatting(commandResult.text), 75)),
      nextState: commandResult.nextState ?? nextState,
      source: "command",
    };
  }

  const llmText = await runLlmPath(history);
  return {
    text: trimForWhatsapp(llmText),
    nextState,
    source: "llm",
  };
}

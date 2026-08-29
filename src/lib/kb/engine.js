import { buildSystemPrompt } from "@/lib/kb/loader";
import {
  formatLiveContext,
  getRecentConversations,
} from "@/lib/kb/live-conversations";
import { resolveTenantByAgent } from "@/lib/kb/resolve-tenant";
import { normalizeWaId } from "@/lib/supabase/server";
import { findGroupPosterMatches } from "@/lib/kb/group-intelligence";
import { buildEmailDraftFromRequest } from "@/lib/email/draft-workflow";
import { sendLeadEmail } from "@/lib/email/resend-client";
import { fireVapiCall, getLatestCallByPhone } from "@/lib/vapi";
import { resolveLeadByName } from "@/lib/kb/leads";
import { getMostRecentCallForPhone, getMostRecentCallFile } from "@/lib/kb/calls";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const WHATSAPP_REPLY_CHAR_LIMIT = 1200;
const PENDING_CONFIRMATION_TTL_MS = 1000 * 60 * 10;

function cloneState(state = {}) {
  return {
    pendingEmailDraft: state.pendingEmailDraft ?? null,
    pendingCallRequest: state.pendingCallRequest ?? null,
    pendingConfirmationExpiry:
      typeof state.pendingConfirmationExpiry === "number" ? state.pendingConfirmationExpiry : null,
    lastPlacedCall: state.lastPlacedCall ?? null,
    pendingSummaryRequest: state.pendingSummaryRequest ?? null,
    pendingSummaryExpiry:
      typeof state.pendingSummaryExpiry === "number" ? state.pendingSummaryExpiry : null,
  };
}

export function defaultKbState() {
  return {
    pendingEmailDraft: null,
    pendingCallRequest: null,
    pendingConfirmationExpiry: null,
    lastPlacedCall: null,
    pendingSummaryRequest: null,
    pendingSummaryExpiry: null,
  };
}

function extractPhoneNumber(text) {
  const raw = String(text || "");
  const match = raw.match(/(\+?\d[\d\s\-().]{6,}\d)/);
  if (!match) return null;
  const digits = match[1].replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7) return null;
  return digits;
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

function extractNameForSummary(text) {
  const raw = String(text ?? "");
  const patterns = [
    /summary of (?:the )?(?:call (?:with|to) )?([a-z][a-z\s'-]{1,40})\s*(?:call|$)/i,
    /recap of (?:the )?(?:call (?:with|to) )?([a-z][a-z\s'-]{1,40})\s*(?:call|$)/i,
    /how did (?:the )?call (?:with|to) ([a-z][a-z\s'-]{1,40})\s*(?:go|went)/i,
    /what did ([a-z][a-z\s'-]{1,40}) say/i,
    /did ([a-z][a-z\s'-]{1,40}) say/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return match[1]
        .replace(/\b(?:the|call|recap|summary|with|to|please)\b/gi, " ")
        .trim();
    }
  }
  return null;
}

async function resolveSummaryTarget({ normalized, lastPlacedCall }) {
  const namedTarget = extractNameForSummary(normalized);
  if (namedTarget) {
    const { matches } = resolveLeadByName(namedTarget);
    if (matches.length) {
      return { name: matches[0].name, phone: matches[0].phone };
    }
  }
  if (lastPlacedCall?.phone) {
    return { name: lastPlacedCall.name, phone: lastPlacedCall.phone };
  }
  const mostRecent = getMostRecentCallFile();
  if (mostRecent?.leadPhone) {
    return { name: mostRecent.leadName, phone: mostRecent.leadPhone };
  }
  return null;
}

function formatKbSummaryReply(lead, content) {
  const summaryBlock = content.match(/--- Call Summary ---\s*([\s\S]*?)(?:\n---|$)/i)?.[1]?.trim();
  const cleaned = cleanupFormatting(summaryBlock || content);
  return `Latest call with ${lead.name} (WhatsApp: ${lead.phone}): ${cleaned}`;
}

function formatLiveSummaryReply(lead, live) {
  const text = live.summary || live.transcript;
  const cleaned = cleanupFormatting(text);
  return `Latest call with ${lead.name} (WhatsApp: ${lead.phone}, status: ${live.status}): ${cleaned}`;
}

async function respondWithCallSummary({ targetLead, state, includeFreshFetch = true }) {
  const kbRecord = getMostRecentCallForPhone(targetLead.phone);
  if (kbRecord) {
    return {
      handled: true,
      text: formatKbSummaryReply(targetLead, kbRecord.content),
      nextState: state,
    };
  }
  if (!includeFreshFetch) {
    return {
      handled: true,
      text: `No saved call yet for ${targetLead.name} at ${targetLead.phone}.`,
      nextState: state,
    };
  }
  try {
    const live = await getLatestCallByPhone(targetLead.phone);
    if (!live) {
      return {
        handled: true,
        text: `No call record found for ${targetLead.name} at ${targetLead.phone}. If we just hung up, VAPI may still be processing — try again in ~60s.`,
        nextState: state,
      };
    }
    if (!live.summary && !live.transcript) {
      return {
        handled: true,
        text: `Call to ${targetLead.name} (${live.status}) exists in VAPI but no summary produced yet. Try again in ~30-60s.`,
        nextState: state,
      };
    }
    return {
      handled: true,
      text: formatLiveSummaryReply(targetLead, live),
      nextState: state,
    };
  } catch (error) {
    return {
      handled: true,
      text: `I couldn't fetch the call summary. ${error.message}`,
      nextState: state,
    };
  }
}

async function runCommandPath(lastUserMessage, messageHistory, state) {
  const text = String(lastUserMessage || "").trim().toLowerCase();
  const normalized = text.replace(/\s+/g, " ");
  const lastAssistantMessage = [...messageHistory]
    .reverse()
    .find((m) => m?.role === "assistant")?.content;

  const pendingCallFromHistory = parsePendingCallFromAssistantMessage(lastAssistantMessage);

  const isSummaryIntent =
    /\b(summary|recap)\b/i.test(normalized) ||
    /\bhow (did|was) (the )?(call|chat|conversation|meeting)\b/i.test(normalized) ||
    /\bhow (did|does|was) (it|that) (go|went|do)\b/i.test(normalized) ||
    /\bwhat did .{1,40}? say\b/i.test(normalized) ||
    /\bdid .{1,40}? (say|mention|agree|confirm)\b/i.test(normalized) ||
    /\b(the )?call (with|to) \w+/i.test(normalized) ||
    /\b(any )?(news|update|outcome|result) (on|from|of) (the )?call\b/i.test(normalized);

  const isCallIntent =
    !isSummaryIntent &&
    (normalized.includes("call ") ||
      normalized.startsWith("call") ||
      normalized.includes("ring "));
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
          lastPlacedCall: {
            name: callLead.name,
            phone: callLead.phone,
            callId: result?.id || null,
            placedAt: Date.now(),
          },
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

  const hasPendingSummary =
    Boolean(state.pendingSummaryRequest) &&
    typeof state.pendingSummaryExpiry === "number" &&
    Date.now() < state.pendingSummaryExpiry;
  const phoneInMessage = extractPhoneNumber(normalized);
  const wantsToFulfillSummary = hasPendingSummary && phoneInMessage;

  if (wantsToFulfillSummary) {
    const targetLead = {
      name: state.pendingSummaryRequest.leadName,
      phone: phoneInMessage,
    };
    return await respondWithCallSummary({
      targetLead,
      state: {
        ...state,
        pendingSummaryRequest: null,
        pendingSummaryExpiry: null,
      },
      includeFreshFetch: true,
    });
  }

  if (isSummaryIntent) {
    const namedLeadInQuery = extractNameForSummary(normalized);
    let resolvedTarget = null;
    if (namedLeadInQuery) {
      const { matches } = resolveLeadByName(namedLeadInQuery);
      if (matches.length) {
        resolvedTarget = { name: matches[0].name, phone: matches[0].phone };
      } else {
        return {
          handled: true,
          text: `I don't have ${namedLeadInQuery} in the lead KB. What's their phone number (e.g. +971501234567)?`,
          nextState: {
            ...state,
            pendingSummaryRequest: { leadName: namedLeadInQuery },
            pendingSummaryExpiry: Date.now() + PENDING_CONFIRMATION_TTL_MS,
          },
        };
      }
    }
    if (!resolvedTarget) {
      const fallback = await resolveSummaryTarget({
        normalized,
        lastPlacedCall: state.lastPlacedCall,
      });
      resolvedTarget = fallback;
    }
    if (!resolvedTarget) {
      return {
        handled: true,
        text: "Which lead's call should I recap? Say 'summary of <name> call' or place a call first.",
        nextState: state,
      };
    }
    return await respondWithCallSummary({
      targetLead: resolvedTarget,
      state,
      includeFreshFetch: true,
    });
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
      const groupMatches = findGroupPosterMatches(targetName, 3);
      if (groupMatches.length) {
        const callable = groupMatches.find((entry) => entry.phone);
        if (callable) {
          const senderName = String(callable.sender || targetName)
            .replace(/^~\s*/, "")
            .trim() || targetName;
          const groupLead = {
            name: senderName,
            phone: callable.phone,
            area: callable.groupName || "Dubai",
            status: "group-intelligence",
          };
          return {
            handled: true,
            text: `Ready to call ${groupLead.name} at ${groupLead.phone}. Source: ${callable.groupName} (${callable.timestamp}). Should I place the call now?`,
            nextState: {
              ...state,
              pendingCallRequest: groupLead,
              pendingConfirmationExpiry: Date.now() + PENDING_CONFIRMATION_TTL_MS,
            },
          };
        }
        const hit = groupMatches[0];
        return {
          handled: true,
          text: `I found ${hit.sender} in group intelligence (${hit.groupName}, ${hit.timestamp}), but no phone number was captured in that message. Ask for a direct number or share one here and I can place the call.`,
          nextState: state,
        };
      }
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
    if (!lead.phone) {
      const detail = [
        lead.area ? `Area: ${lead.area}` : null,
        lead.status ? `Status: ${lead.status}` : null,
        lead.lastContact ? `Last contact: ${lead.lastContact}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        handled: true,
        text: `I found ${lead.name} in your roster but there is no phone number on file.${detail ? ` ${detail}.` : ""} Add their mobile in CRM or upload a WhatsApp context file, then try again.`,
        nextState: state,
      };
    }
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

async function resolveTenantForKbTurn(callerWaId) {
  const normalizedCaller = normalizeWaId(callerWaId);

  if (normalizedCaller) {
    const tenant = await resolveTenantByAgent(normalizedCaller);
    if (!tenant) {
      return {
        tenant: null,
        unregistered: true,
      };
    }
    return { tenant, unregistered: false };
  }

  return { tenant: null, unregistered: true };
}

async function runLlmPath(messages, userQuery = "", callerWaId = null) {
  const tenantResolution = await resolveTenantForKbTurn(callerWaId);
  if (tenantResolution.unregistered) {
    return "You're not registered on AgentZero yet. Ask your admin to add your WhatsApp number.";
  }

  let liveContext = "";
  if (tenantResolution.tenant?.id) {
    try {
      const conversations = await getRecentConversations(tenantResolution.tenant.id, {
        limit: 5,
        messageLimit: 10,
      });
      liveContext = formatLiveContext(conversations);
    } catch (error) {
      console.error("Live conversation context unavailable:", error.message);
    }
  }

  const prompt = buildSystemPrompt(userQuery, { liveContext });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const normalizedMessages = messages.map((m, idx) => {
    const isLast = idx === messages.length - 1;
    if (isLast && m.role === "user") {
      return {
        role: m.role,
        content: `${m.content}\n\nOutput constraints: 30-75 words only. Lead with recommendation first. Do not include sources. Use FirstName + last initial only (example: Tariq H.). Include recency in brackets. Always include WhatsApp number when available for lead chats. For group intelligence, include sender display name, timestamp, and group name; never offer to call/email group posters unless contact details are explicitly in the message. End with one short question if useful.`,
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

export async function runKbTurn({ messages, state, callerWaId = null }) {
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

  const llmText = await runLlmPath(history, lastUserMessage, callerWaId);
  return {
    text: trimForWhatsapp(llmText),
    nextState,
    source: "llm",
  };
}

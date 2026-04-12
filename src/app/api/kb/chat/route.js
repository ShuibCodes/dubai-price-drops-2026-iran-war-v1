import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "@/lib/kb/loader";
import {
  getTargetLeadContext,
  getLatestTargetLeadCallSummary,
  getTargetLead,
  startTargetLeadCall,
} from "@/lib/vapi/client";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function limitWords(text, maxWords = 75) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function cleanupFormatting(text) {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function createSseResponse(text) {
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
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
  ];
  return affirmativePhrases.some((phrase) => normalized.includes(phrase));
}

async function handleCommand(lastUserMessage, messages = []) {
  const text = String(lastUserMessage || "").trim().toLowerCase();
  const lead = getTargetLead();
  const normalized = text.replace(/\s+/g, " ");
  const mentionsTargetLead =
    normalized.includes("shuayb") || normalized.includes("ahmed");
  const includesCallActionVerb =
    normalized.includes("call") ||
    normalized.includes("ring") ||
    normalized.includes("phone");
  const isCallRequest =
    ["call shuayb", "call ahmed"].includes(normalized) ||
    (mentionsTargetLead && includesCallActionVerb);
  const isLegacyConfirmRequest = ["confirm call shuayb", "confirm call ahmed"].includes(
    normalized
  );
  const isSummaryRequest = normalized === "summary";
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((m) => m?.role === "assistant")?.content;
  const pendingCallConfirmation =
    String(lastAssistantMessage || "")
      .toLowerCase()
      .includes("should i place the call");
  const pendingSummaryConfirmation =
    String(lastAssistantMessage || "")
      .toLowerCase()
      .includes("should i fetch the latest call summary");
  const shouldProceedByAffirmation =
    isAffirmative(normalized) && pendingCallConfirmation;
  const shouldFetchSummaryByAffirmation =
    isAffirmative(normalized) && pendingSummaryConfirmation;

  if (isCallRequest) {
    return `Ready to call ${lead.name} at WhatsApp: ${lead.phoneNumber}. Should I place the call now?`;
  }

  if (shouldProceedByAffirmation || isLegacyConfirmRequest) {
    try {
      const result = await startTargetLeadCall();
      const areaNote = result.leadContext?.listing_area
        ? ` I passed listing area as ${result.leadContext.listing_area}.`
        : "";
      return `Call initiated for ${lead.name} at ${lead.phoneNumber}. Call ID: ${result.callId || "pending"}.${areaNote} If you want a call recap, reply with "summary".`;
    } catch (error) {
      return `I couldn't start the call right now. ${error.message}`;
    }
  }

  if (isSummaryRequest || shouldFetchSummaryByAffirmation) {
    try {
      const summary = await getLatestTargetLeadCallSummary();
      if (!summary.found) return summary.message;

      return `Latest ${lead.name} call summary: ${cleanupFormatting(summary.summary)} [status: ${summary.status}].`;
    } catch (error) {
      return `I couldn't fetch the latest call summary. ${error.message}`;
    }
  }

  if (
    mentionsTargetLead &&
    !isCallRequest &&
    !isLegacyConfirmRequest &&
    !shouldProceedByAffirmation &&
    !shouldFetchSummaryByAffirmation
  ) {
    const leadContext = getTargetLeadContext();
    const keyNotes = leadContext.context_notes?.slice(0, 2).join(" ");
    return `${lead.name} context: ${keyNotes || leadContext.call_brief || "No additional context found."} WhatsApp: ${lead.phoneNumber}. If you want call recap details, reply with "summary".`;
  }

  return null;
}

export async function POST(request) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "Messages array is required" }, { status: 400 });
    }

    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m?.role === "user")?.content;
    const commandText = await handleCommand(lastUserMessage, messages);
    if (commandText) {
      return createSseResponse(limitWords(cleanupFormatting(commandText), 75));
    }

    const prompt = buildSystemPrompt();

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

    const completion = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 320,
      system: prompt,
      messages: normalizedMessages,
    });

    const rawText = completion.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    const text = limitWords(cleanupFormatting(rawText), 75);

    return createSseResponse(text);
  } catch (error) {
    console.error("KB Chat API Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

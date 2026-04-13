import { buildSystemPrompt } from "@/lib/kb/loader";
import { buildEmailDraftFromRequest } from "@/lib/email/draft-workflow";
import { sendLeadEmail } from "@/lib/email/resend-client";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
let pendingEmailDraft = null;

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
  const normalized = text.replace(/\s+/g, " ");
  const isEmailIntent =
    normalized.includes("email ") ||
    normalized.startsWith("email") ||
    normalized.includes("send an email") ||
    normalized.includes("send email");

  const hasPendingEmailApproval = Boolean(pendingEmailDraft);
  const wantsToSendEmail = isAffirmative(normalized) && hasPendingEmailApproval;
  const wantsToCancelEmail =
    hasPendingEmailApproval &&
    (normalized.includes("cancel") || normalized.includes("stop") || normalized.includes("no"));

  if (wantsToCancelEmail) {
    pendingEmailDraft = null;
    return "Email draft cancelled.";
  }

  if (wantsToSendEmail) {
    try {
      const result = await sendLeadEmail({
        to: pendingEmailDraft.to,
        subject: pendingEmailDraft.subject,
        text: pendingEmailDraft.body,
        metadata: {
          leadName: pendingEmailDraft.leadName,
          listingArea: pendingEmailDraft.variables?.listing_area,
          transcriptSource: pendingEmailDraft.transcriptSource,
        },
      });
      const sentTo = pendingEmailDraft.to;
      pendingEmailDraft = null;
      return `Email sent to ${sentTo}. Resend message ID: ${result?.id || "n/a"}.`;
    } catch (error) {
      return `I could not send the email yet. ${error.message}`;
    }
  }

  if (isEmailIntent) {
    try {
      const draft = await buildEmailDraftFromRequest(lastUserMessage);
      if (!draft.to) {
        pendingEmailDraft = null;
        return "I drafted the email but could not find a recipient email in the transcript. Add an email in the lead context first.";
      }
      pendingEmailDraft = draft;
      return `Draft ready for ${draft.to}. Subject: ${draft.subject}. ${draft.body} Should I send this email now?`;
    } catch (error) {
      return `I couldn't prepare the email draft. ${error.message}`;
    }
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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 503 });
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
    const text = limitWords(cleanupFormatting(rawText), 75);

    return createSseResponse(text);
  } catch (error) {
    console.error("KB Chat API Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

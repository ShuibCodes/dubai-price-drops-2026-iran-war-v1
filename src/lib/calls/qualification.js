const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

const VALID_INTENTS = new Set(["live", "invest", "browsing"]);
const VALID_OUTCOMES = new Set([
  "qualified",
  "callback",
  "not_interested",
  "voicemail",
  "no_answer",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function stripCodeFences(text) {
  return clean(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeQualification(raw = {}) {
  const intent = clean(raw.intent).toLowerCase();
  const outcome = clean(raw.outcome).toLowerCase();
  const areas = Array.isArray(raw.areas)
    ? raw.areas.map((a) => clean(a)).filter(Boolean)
    : raw.areas
      ? [clean(raw.areas)].filter(Boolean)
      : [];

  return {
    intent: VALID_INTENTS.has(intent) ? intent : null,
    budget_aed: raw.budget_aed != null ? String(raw.budget_aed) : null,
    areas,
    timeline: raw.timeline != null ? String(raw.timeline) : null,
    callback_time: raw.callback_time != null ? String(raw.callback_time) : null,
    outcome: VALID_OUTCOMES.has(outcome) ? outcome : null,
  };
}

export function qualificationFromStructuredData(structuredData) {
  if (!structuredData || typeof structuredData !== "object") return null;
  const normalized = normalizeQualification(structuredData);
  if (
    normalized.intent ||
    normalized.budget_aed ||
    normalized.areas.length ||
    normalized.timeline ||
    normalized.callback_time ||
    normalized.outcome
  ) {
    return normalized;
  }
  return null;
}

export async function qualifyCallFromTranscript({ transcript, summary, endedReason }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("qualifyCallFromTranscript: ANTHROPIC_API_KEY not set");
    return normalizeQualification({});
  }

  const prompt = `You are analyzing a real estate outbound phone call transcript.
Return ONLY valid JSON (no markdown, no explanation) with this exact shape:
{
  "intent": "live" | "invest" | "browsing" | null,
  "budget_aed": string | null,
  "areas": string[],
  "timeline": string | null,
  "callback_time": string | null,
  "outcome": "qualified" | "callback" | "not_interested" | "voicemail" | "no_answer"
}

Rules:
- intent: live = wants to move in, invest = investment buyer, browsing = early stage
- outcome: qualified = engaged and actionable, callback = wants follow-up, not_interested = declined, voicemail = left message, no_answer = no pickup
- Use null for unknown fields
- areas should be Dubai area names mentioned, empty array if none

Call ended reason: ${clean(endedReason) || "unknown"}

Summary:
${clean(summary) || "(none)"}

Transcript:
${clean(transcript) || "(none)"}`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("qualifyCallFromTranscript: Anthropic error", body?.error?.message);
      return normalizeQualification({});
    }

    const rawText = (body.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    const parsed = JSON.parse(stripCodeFences(rawText));
    return normalizeQualification(parsed);
  } catch (error) {
    console.error("qualifyCallFromTranscript:", error.message);
    return normalizeQualification({});
  }
}

export async function resolveQualification({ structuredData, transcript, summary, endedReason }) {
  const fromStructured = qualificationFromStructuredData(structuredData);
  if (fromStructured) return fromStructured;
  return qualifyCallFromTranscript({ transcript, summary, endedReason });
}

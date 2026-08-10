const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

/** @typedef {"real_estate" | "course"} QualificationProfile */

const VALID_INTENTS = new Set(["live", "invest", "browsing"]);
const VALID_OUTCOMES = new Set([
  "qualified",
  "callback",
  "not_interested",
  "voicemail",
  "no_answer",
]);
const VALID_TRACKS = new Set(["freelance", "tech_job", "general"]);

function clean(value) {
  return String(value ?? "").trim();
}

function stripCodeFences(text) {
  return clean(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeTriState(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function normalizeQualification(raw = {}, profile = "real_estate") {
  const intent = clean(raw.intent).toLowerCase();
  const outcome = clean(raw.outcome).toLowerCase();
  const areas = Array.isArray(raw.areas)
    ? raw.areas.map((a) => clean(a)).filter(Boolean)
    : raw.areas
      ? [clean(raw.areas)].filter(Boolean)
      : [];

  const track = clean(raw.interest_track).toLowerCase().replace(/\s+/g, "_");

  const base = {
    intent: VALID_INTENTS.has(intent) ? intent : null,
    budget_aed: raw.budget_aed != null ? String(raw.budget_aed) : null,
    areas,
    timeline: raw.timeline != null ? String(raw.timeline) : null,
    callback_time: raw.callback_time != null ? String(raw.callback_time) : null,
    outcome: VALID_OUTCOMES.has(outcome) ? outcome : null,
    lead_engaged: raw.lead_engaged === true || raw.lead_engaged === "true",
    crm_note: clean(raw.crm_note) || null,
    profile: profile === "course" ? "course" : "real_estate",
  };

  if (profile === "course") {
    return {
      ...base,
      // Course-specific — leave real-estate fields empty unless model set them.
      intent: null,
      budget_aed: null,
      areas: [],
      timeline: null,
      still_priority: normalizeTriState(raw.still_priority),
      ok_for_consultant: normalizeTriState(raw.ok_for_consultant),
      interest_track: VALID_TRACKS.has(track) ? track : null,
      preferred_contact: raw.preferred_contact != null ? clean(raw.preferred_contact) : null,
    };
  }

  return base;
}

const INTENT_SENTENCES = {
  live: "Lead is looking for a home to live in.",
  invest: "Lead is an investment buyer.",
  browsing: "Lead is at an early browsing stage.",
};

const OUTCOME_LABELS = {
  qualified: "Qualified",
  callback: "Callback requested",
  not_interested: "Not interested",
  voicemail: "Voicemail",
  no_answer: "No answer",
};

/** Fallback note when the model (or structuredData) didn't provide one. */
export function composeCrmNote(qualification = {}, summary = "") {
  const outcomeLabel = OUTCOME_LABELS[qualification.outcome] || "Call completed";
  const isCourse = qualification.profile === "course";
  const lines = [
    isCourse
      ? `Pivot to Tech AI Call — ${outcomeLabel}`
      : `AgentZero AI Call — ${outcomeLabel}`,
  ];

  const facts = [];
  if (isCourse) {
    if (qualification.still_priority === true) {
      facts.push("AI career is still a priority.");
    } else if (qualification.still_priority === false) {
      facts.push("AI career is no longer a priority.");
    }
    if (qualification.ok_for_consultant === true) {
      facts.push("Open to a consultant reaching out about the current cohort.");
    } else if (qualification.ok_for_consultant === false) {
      facts.push("Declined consultant outreach.");
    }
    if (qualification.interest_track) {
      facts.push(`Interest track: ${qualification.interest_track.replace("_", " ")}.`);
    }
    if (qualification.preferred_contact) {
      facts.push(`Preferred contact: ${qualification.preferred_contact}.`);
    }
  } else {
    if (qualification.intent && INTENT_SENTENCES[qualification.intent]) {
      facts.push(INTENT_SENTENCES[qualification.intent]);
    }
    if (qualification.budget_aed) {
      facts.push(`Budget around AED ${qualification.budget_aed}.`);
    }
    if (Array.isArray(qualification.areas) && qualification.areas.length) {
      facts.push(`Interested in ${qualification.areas.join(", ")}.`);
    }
    if (qualification.timeline) {
      facts.push(`Timeline: ${qualification.timeline}.`);
    }
  }
  if (qualification.callback_time) {
    facts.push(`Callback requested for ${qualification.callback_time}.`);
  }
  if (facts.length) lines.push(facts.join(" "));

  const summarySentence = clean(summary).split(/(?<=[.!?])\s+/)[0] || "";
  if (summarySentence) lines.push(summarySentence);

  return lines.join("\n");
}

export function qualificationFromStructuredData(structuredData, profile = "real_estate") {
  if (!structuredData || typeof structuredData !== "object") return null;
  const normalized = normalizeQualification(structuredData, profile);
  if (profile === "course") {
    if (
      normalized.outcome ||
      normalized.lead_engaged ||
      normalized.still_priority != null ||
      normalized.ok_for_consultant != null ||
      normalized.interest_track ||
      normalized.crm_note
    ) {
      return normalized;
    }
    return null;
  }
  if (
    normalized.intent ||
    normalized.budget_aed ||
    normalized.areas.length ||
    normalized.timeline ||
    normalized.callback_time ||
    normalized.outcome ||
    normalized.lead_engaged
  ) {
    return normalized;
  }
  return null;
}

function realEstatePrompt({ transcript, summary, endedReason }) {
  return `You are analyzing a real estate outbound phone call transcript.
Return ONLY valid JSON (no markdown, no explanation) with this exact shape:
{
  "intent": "live" | "invest" | "browsing" | null,
  "budget_aed": string | null,
  "areas": string[],
  "timeline": string | null,
  "callback_time": string | null,
  "outcome": "qualified" | "callback" | "not_interested" | "voicemail" | "no_answer",
  "lead_engaged": boolean,
  "crm_note": string
}

Rules:
- intent: live = wants to move in, invest = investment buyer, browsing = early stage
- outcome: qualified = engaged and actionable, callback = wants follow-up, not_interested = declined, voicemail = left message, no_answer = no pickup
- Use null for unknown fields
- areas should be Dubai area names mentioned, empty array if none
- lead_engaged: true ONLY if the lead contributed at least one substantive conversational turn beyond a greeting or an immediate rejection/hangup (e.g. answered a question, shared a preference, asked something back); false for voicemail, no answer, greeting-only, or instant hangup/rejection
- crm_note: a polished, broker-ready activity note, 3-5 short lines of plain text separated by newlines. First line exactly "AgentZero AI Call — {outcome}". Then only the qualification facts that actually exist (intent, budget, areas, timeline, callback) written as natural sentences — omit anything unknown entirely, never print empty labels like "Budget: null". End with a one-sentence summary of the conversation. No markdown, no emojis, no ISO timestamps.

Call ended reason: ${clean(endedReason) || "unknown"}

Summary:
${clean(summary) || "(none)"}

Transcript:
${clean(transcript) || "(none)"}`;
}

function coursePrompt({ transcript, summary, endedReason }) {
  return `You are analyzing an outbound phone call from Pivot to Tech about an AI career / course form fill.
This has NOTHING to do with real estate. Do not mention property, budget AED, Dubai areas, or brokers.

The caller asked roughly:
1) Is getting into an AI career still a priority?
2) Would they mind a consultant reaching out with details to see if they qualify for the current cohort?
Then briefly mentioned learning to build AI voice agents and landing industry roles.

Return ONLY valid JSON (no markdown, no explanation) with this exact shape:
{
  "still_priority": true | false | null,
  "ok_for_consultant": true | false | null,
  "interest_track": "freelance" | "tech_job" | "general" | null,
  "preferred_contact": string | null,
  "callback_time": string | null,
  "outcome": "qualified" | "callback" | "not_interested" | "voicemail" | "no_answer",
  "lead_engaged": boolean,
  "crm_note": string
}

Rules:
- still_priority: true if AI career is still important; false if they said no longer; null if unclear / no answer
- ok_for_consultant: true if they agree to consultant outreach; false if they decline; null if unclear
- interest_track: freelance vs tech job vs general if mentioned; else null
- preferred_contact: whatsapp/phone/email/etc if they said how to reach them; else null
- outcome: qualified = engaged AND (still priority and/or open to consultant) and actionable; callback = wants follow-up later; not_interested = declined / not a priority; voicemail = voicemail; no_answer = no pickup
- lead_engaged: true ONLY if the lead contributed at least one substantive conversational turn beyond a greeting or an immediate rejection/hangup; false for voicemail, no answer, greeting-only, or instant hangup
- crm_note: polished ops note, 3-5 short plain-text lines separated by newlines. First line exactly "Pivot to Tech AI Call — {outcome}". Then only facts that exist (priority, consultant yes/no, track, contact preference, callback) as natural sentences — omit unknowns, never print empty labels. End with one sentence summarizing the call. No markdown, no emojis, no ISO timestamps. Never mention real estate.

Call ended reason: ${clean(endedReason) || "unknown"}

Summary:
${clean(summary) || "(none)"}

Transcript:
${clean(transcript) || "(none)"}`;
}

export async function qualifyCallFromTranscript({
  transcript,
  summary,
  endedReason,
  profile = "real_estate",
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("qualifyCallFromTranscript: ANTHROPIC_API_KEY not set");
    return normalizeQualification({}, profile);
  }

  const prompt =
    profile === "course"
      ? coursePrompt({ transcript, summary, endedReason })
      : realEstatePrompt({ transcript, summary, endedReason });

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
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("qualifyCallFromTranscript: Anthropic error", body?.error?.message);
      return normalizeQualification({}, profile);
    }

    const rawText = (body.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    const parsed = JSON.parse(stripCodeFences(rawText));
    return normalizeQualification(parsed, profile);
  } catch (error) {
    console.error("qualifyCallFromTranscript:", error.message);
    return normalizeQualification({}, profile);
  }
}

/**
 * @param {{ structuredData?: object, transcript?: string, summary?: string, endedReason?: string, profile?: QualificationProfile }} args
 */
export async function resolveQualification({
  structuredData,
  transcript,
  summary,
  endedReason,
  profile = "real_estate",
}) {
  const resolvedProfile = profile === "course" ? "course" : "real_estate";
  const fromStructured = qualificationFromStructuredData(
    structuredData,
    resolvedProfile
  );
  const qualification =
    fromStructured ||
    (await qualifyCallFromTranscript({
      transcript,
      summary,
      endedReason,
      profile: resolvedProfile,
    }));

  if (!qualification.crm_note) {
    qualification.crm_note = composeCrmNote(qualification, summary);
  }

  return qualification;
}

/** Map tenant slug / call source → qualification profile. */
export function qualificationProfileFor({ tenantSlug, source } = {}) {
  const slug = clean(tenantSlug).toLowerCase();
  const src = clean(source).toLowerCase();
  if (
    slug === "ghl-courses" ||
    src === "ghl" ||
    src.startsWith("ghl-courses") ||
    src.includes("course")
  ) {
    return "course";
  }
  return "real_estate";
}

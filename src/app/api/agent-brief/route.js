import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const SEARCH_LIMIT = 3;
const sessionSearchUsage = new Map();
const SYSTEM_PROMPT = `You are a Dubai property search assistant. Extract search filters from the user's message and return ONLY a JSON object with these fields:
- bedrooms: number or null. "Studio" means 0 bedrooms.
- maxPrice: number or null. "Below 800k" or "under 1.5M" means maxPrice, NOT belowBaselineOnly.
- minPrice: number or null.
- area: string or null. Use the area name as written (e.g. "JVC", "Dubai Marina", "Business Bay").
- propertyType: "apartment" | "villa" | null.
- maxDaysOnMarket: number or null. "Listed in the last 30 days" means 30.
- belowBaselineOnly: boolean. ONLY set true when the user explicitly mentions "pre-war", "baseline", "pre-war prices", or "war discount". Words like "cheap", "below [price]", "under [price]", or "affordable" do NOT trigger this flag.
Return nothing else.`;

function normalizeSessionId(value) {
  if (typeof value !== "string") {
    return "anonymous-session";
  }
  const normalized = value.trim();
  return normalized || "anonymous-session";
}

function readSessionUsage(sessionId) {
  return sessionSearchUsage.get(sessionId) ?? 0;
}

function incrementSessionUsage(sessionId) {
  const next = readSessionUsage(sessionId) + 1;
  sessionSearchUsage.set(sessionId, next);
  return next;
}

function coerceNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/,/g, "").replace(/aed/g, "");
  if (!normalized) {
    return null;
  }

  const multiplier = normalized.endsWith("m")
    ? 1_000_000
    : normalized.endsWith("k")
      ? 1_000
      : 1;
  const numericPortion = multiplier === 1 ? normalized : normalized.slice(0, -1);
  const parsed = Number(numericPortion);

  return Number.isFinite(parsed) ? parsed * multiplier : null;
}

function normalizePropertyType(value) {
  if (value === "apartment" || value === "villa") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.includes("villa")) {
    return "villa";
  }
  if (normalized.includes("apartment") || normalized.includes("flat")) {
    return "apartment";
  }

  return null;
}

function normalizeArea(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeFilters(rawFilters) {
  const filters = {
    bedrooms: null,
    maxPrice: null,
    minPrice: null,
    area: null,
    propertyType: null,
    maxDaysOnMarket: null,
    belowBaselineOnly: false,
  };

  if (!rawFilters || typeof rawFilters !== "object") {
    return {
      filters,
      parsed: false,
    };
  }

  const bedrooms = coerceNumber(rawFilters.bedrooms);
  const maxPrice = coerceNumber(rawFilters.maxPrice);
  const minPrice = coerceNumber(rawFilters.minPrice);
  const maxDaysOnMarket = coerceNumber(rawFilters.maxDaysOnMarket);

  filters.bedrooms = Number.isFinite(bedrooms) ? Math.max(0, Math.round(bedrooms)) : null;
  filters.maxPrice = Number.isFinite(maxPrice) ? Math.max(0, Math.round(maxPrice)) : null;
  filters.minPrice = Number.isFinite(minPrice) ? Math.max(0, Math.round(minPrice)) : null;
  filters.area = normalizeArea(rawFilters.area);
  filters.propertyType = normalizePropertyType(rawFilters.propertyType);
  filters.maxDaysOnMarket = Number.isFinite(maxDaysOnMarket)
    ? Math.max(0, Math.round(maxDaysOnMarket))
    : null;
  filters.belowBaselineOnly = Boolean(rawFilters.belowBaselineOnly);

  if (
    filters.minPrice !== null &&
    filters.maxPrice !== null &&
    filters.minPrice > filters.maxPrice
  ) {
    [filters.minPrice, filters.maxPrice] = [filters.maxPrice, filters.minPrice];
  }

  const parsed = Object.entries(filters).some(([key, value]) => {
    if (key === "belowBaselineOnly") {
      return value === true;
    }

    return value !== null;
  });

  return { filters, parsed };
}

function extractMessageContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part?.type === "text") {
          return part.text ?? "";
        }
        return "";
      })
      .join("");
  }

  return null;
}

export async function POST(request) {
  const apiKey = process.env.OPENAI_API_KEY;
  let body;
  const sessionId = normalizeSessionId(request.headers.get("x-agent-brief-session"));

  try {
    body = await request.json();
  } catch {
    // #region agent log
    fetch("http://127.0.0.1:7865/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6e29d8" },
      body: JSON.stringify({
        sessionId: "6e29d8",
        runId: "pre-fix",
        hypothesisId: "H5",
        location: "src/app/api/agent-brief/route.js:POST:invalid-json",
        message: "Agent brief request had invalid JSON body",
        data: {},
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  // #region agent log
  fetch("http://127.0.0.1:7865/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6e29d8" },
    body: JSON.stringify({
      sessionId: "6e29d8",
      runId: "pre-fix",
      hypothesisId: "H1_H5",
      location: "src/app/api/agent-brief/route.js:POST:start",
      message: "Agent brief API request started",
      data: { hasApiKey: Boolean(apiKey), messageLength: message.length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 503 });
  }

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const currentUsage = readSessionUsage(sessionId);
  if (currentUsage >= SEARCH_LIMIT) {
    return NextResponse.json(
      {
        error: "Free brief limit reached. Click Get Alerts to unlock paid unlimited deal matching soon.",
        limitReached: true,
        searchesUsed: currentUsage,
        searchesRemaining: 0,
      },
      { status: 429 }
    );
  }

  const updatedUsage = incrementSessionUsage(sessionId);
  const searchesRemaining = Math.max(0, SEARCH_LIMIT - updatedUsage);

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message },
        ],
      }),
      cache: "no-store",
    });

    const payload = await response.json();
    // #region agent log
    fetch("http://127.0.0.1:7865/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6e29d8" },
      body: JSON.stringify({
        sessionId: "6e29d8",
        runId: "pre-fix",
        hypothesisId: "H1_H2",
        location: "src/app/api/agent-brief/route.js:POST:openai-response",
        message: "OpenAI parse response received",
        data: {
          ok: response.ok,
          status: response.status,
          hasChoices: Array.isArray(payload?.choices),
          upstreamError: payload?.error?.message ?? null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.error?.message ?? "OpenAI request failed" },
        { status: response.status >= 400 && response.status < 600 ? response.status : 502 }
      );
    }

    const content = extractMessageContent(payload);
    if (!content) {
      return NextResponse.json(
        { error: "OpenAI returned an empty response", parsed: false },
        { status: 502 }
      );
    }

    let rawFilters;
    try {
      rawFilters = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: "OpenAI returned invalid JSON", parsed: false },
        { status: 502 }
      );
    }

    const { filters, parsed } = normalizeFilters(rawFilters);
    // #region agent log
    fetch("http://127.0.0.1:7865/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6e29d8" },
      body: JSON.stringify({
        sessionId: "6e29d8",
        runId: "pre-fix",
        hypothesisId: "H2",
        location: "src/app/api/agent-brief/route.js:POST:normalized-filters",
        message: "Normalized filters from OpenAI payload",
        data: { parsed, filters },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return NextResponse.json({ filters, parsed, searchesUsed: updatedUsage, searchesRemaining });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message ?? "Failed to parse agent brief",
        parsed: false,
        searchesUsed: updatedUsage,
        searchesRemaining,
      },
      { status: 502 }
    );
  }
}

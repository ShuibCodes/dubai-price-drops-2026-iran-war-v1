import { promises as fs } from "fs";
import path from "path";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

function sanitizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\p{L}\s'-]/gu, "");
}

function parseBedrooms(message) {
  const match = String(message).match(/(\d+)\s*[- ]?\s*(bed|br|bedroom)/i);
  if (!match) return null;
  return Number(match[1]);
}

function parseArea(message) {
  const knownAreas = [
    "Dubai Marina",
    "Marina",
    "JVC",
    "Business Bay",
    "Downtown",
    "Downtown Dubai",
    "Jumeirah",
    "Jumeirah 1",
    "Jumeirah 2",
    "Jumeirah 3",
    "Umm Suqeim",
    "JLT",
    "Palm Jumeirah",
  ];
  const lower = String(message).toLowerCase();
  const found = knownAreas.find((area) => lower.includes(area.toLowerCase()));
  return found ?? null;
}

function parseLeadName(message) {
  const text = String(message ?? "");
  const match = text.match(/\bemail\s+([a-z][a-z\s'-]{1,40})\b/i);
  if (!match) return null;
  const chunk = match[1].replace(/\s+about[\s\S]*$/i, "").trim();
  const firstWord = chunk.split(/\s+/)[0];
  return sanitizeName(firstWord || chunk);
}

function parseBudget(message) {
  const text = String(message ?? "").toLowerCase().replace(/,/g, "");
  const aedMatch = text.match(/(\d+(?:\.\d+)?)\s*(k|m)?\s*(aed|dh|dirham)/i);
  if (!aedMatch) return null;
  const base = Number(aedMatch[1]);
  if (!Number.isFinite(base)) return null;
  const unit = (aedMatch[2] || "").toLowerCase();
  const multiplier = unit === "m" ? 1_000_000 : unit === "k" ? 1_000 : 1;
  return Math.round(base * multiplier);
}

function parseLeadEmail(text) {
  const match = String(text ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function stripEmDash(text) {
  return String(text ?? "").replace(/—/g, "-").trim();
}

function truncateWords(text, maxWords = 110) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

async function tryReadWhatsappTranscript(leadName) {
  const dataDir = path.join(process.cwd(), "data", "whatsapp");
  const safeLead = sanitizeName(leadName).toLowerCase();

  try {
    const entries = await fs.readdir(dataDir);
    const txtFiles = entries.filter((name) => name.toLowerCase().endsWith(".txt"));
    if (!txtFiles.length) return { transcript: null, sourceFile: null };

    const scored = await Promise.all(
      txtFiles.map(async (fileName) => {
        const fullPath = path.join(dataDir, fileName);
        const content = await fs.readFile(fullPath, "utf8");
        let score = 0;
        const fileLower = fileName.toLowerCase();
        const contentLower = content.toLowerCase();
        if (safeLead && fileLower.includes(safeLead)) score += 5;
        if (safeLead && contentLower.includes(safeLead)) score += 3;
        if (fileLower.includes("context")) score += 1;
        return { fileName, content, score };
      })
    );

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score <= 0) return { transcript: null, sourceFile: null };
    return { transcript: best.content, sourceFile: best.fileName };
  } catch {
    return { transcript: null, sourceFile: null };
  }
}

async function extractWithAnthropic({ prompt, leadName, transcript, listing }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const userPrompt = `Create a concise property follow-up email draft as JSON.
Rules:
- no em dashes
- short and direct
- final sentence must ask if they want more details of the property
- return only valid JSON
- prioritize explicit user instructions over inferred or fetched listing details
- if user gives a specific bedroom/price/area instruction, keep those values in the draft
- do not invent listing details not present in user request or transcript context

Input:
lead_name_hint: ${leadName || "unknown"}
user_request: ${prompt}
transcript: ${transcript || "none"}
listing_json: ${JSON.stringify(listing)}

JSON shape:
{
  "firstName": "string",
  "email": "string|null",
  "listing_area": "string",
  "bedrooms": "string|null",
  "budget": "string|null",
  "lastInteraction": "string|null",
  "subject": "string",
  "body": "string"
}`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      temperature: 0.2,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Anthropic returned non-JSON response (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Anthropic request failed (${response.status})`);
  }

  const text = payload?.content?.find((entry) => entry?.type === "text")?.text ?? "";
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  return JSON.parse(withoutFence);
}

function buildFallbackDraft({ leadName, transcript, listing, prompt }) {
  const firstName = sanitizeName(leadName || "there").split(/\s+/)[0] || "there";
  const email = parseLeadEmail(transcript);
  const area = listing?.area || parseArea(prompt) || "Dubai";
  const beds = listing?.bedrooms ? `${listing.bedrooms} bed` : null;
  const price = listing?.price ? `${Number(listing.price).toLocaleString("en-AE")} AED` : "price on request";
  const subject = `${beds ?? "Property"} option in ${area}`;
  const body = [
    `Hi ${firstName},`,
    "",
    `Sharing a ${beds ?? "property"} option in ${area} at ${price}.`,
    "Happy to send the full specs and availability update.",
    "Do you want to see more details of this property?",
  ].join("\n");

  return {
    firstName,
    email,
    listing_area: area,
    bedrooms: beds,
    budget: null,
    lastInteraction: null,
    subject,
    body,
  };
}

export async function buildEmailDraftFromRequest(prompt) {
  const leadName = parseLeadName(prompt);
  const { transcript, sourceFile } = await tryReadWhatsappTranscript(leadName);
  const area = parseArea(prompt);
  const bedrooms = parseBedrooms(prompt);
  const budget = parseBudget(prompt);
  const listing = {
    area: area ?? "Dubai",
    bedrooms: bedrooms ?? null,
    price: budget ?? null,
    title: "Property listing",
  };

  let extracted;
  try {
    extracted = await extractWithAnthropic({
      prompt,
      leadName,
      transcript,
      listing,
    });
  } catch {
    extracted = buildFallbackDraft({ leadName, transcript, listing, prompt });
  }

  const body = truncateWords(stripEmDash(extracted.body), 110);
  const subject = stripEmDash(extracted.subject || `Property in ${listing.area || "Dubai"}`);

  return {
    leadName: extracted.firstName || sanitizeName(leadName) || "there",
    to: extracted.email || parseLeadEmail(transcript),
    subject,
    body,
    variables: {
      firstName: extracted.firstName || sanitizeName(leadName) || "there",
      listing_area: extracted.listing_area || listing.area || "Dubai",
      bedrooms: extracted.bedrooms || (listing.bedrooms ? `${listing.bedrooms} bed` : null),
      budget: extracted.budget || null,
      lastInteraction: extracted.lastInteraction || null,
    },
    transcriptSource: sourceFile,
    listing,
    missingEmail: !(extracted.email || parseLeadEmail(transcript)),
  };
}

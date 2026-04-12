import fs from "fs";
import path from "path";
import { findAreasInText } from "@/lib/kb/dubai-areas";

const TARGET_LEAD_NAME = "Shuayb";
const TARGET_LEAD_PHONE = "+971585690693";
const TARGET_LEAD_TRANSCRIPT_PATH =
  process.env.TARGET_LEAD_TRANSCRIPT_PATH ||
  "data/whatsapp/shuayb-context.txt";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getVapiConfig() {
  return {
    apiKey: getRequiredEnv("VAPI_API_KEY"),
    assistantId: getRequiredEnv("VAPI_ASSISTANT_ID"),
    phoneNumberId: getRequiredEnv("VAPI_PHONE_NUMBER_ID"),
    baseUrl: process.env.VAPI_BASE_URL || "https://api.vapi.ai",
    createPath: process.env.VAPI_CALL_CREATE_PATH || "/call/phone",
    callsPath: process.env.VAPI_CALLS_PATH || "/call",
  };
}

function getAuthHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function normalizeSummary(call) {
  const transcript =
    call?.analysis?.transcript ||
    call?.transcript ||
    call?.recording?.transcript ||
    call?.summary ||
    "";
  const summary =
    call?.analysis?.summary || call?.summary || call?.analysis?.result || "";

  return {
    callId: call?.id || call?.callId || null,
    status: call?.status || call?.state || "unknown",
    startedAt: call?.startedAt || call?.createdAt || null,
    endedAt: call?.endedAt || null,
    summary: summary || "No summary available yet.",
    transcript: transcript || "No transcript available yet.",
  };
}

function readTargetLeadTranscript() {
  try {
    const filePath = path.join(process.cwd(), TARGET_LEAD_TRANSCRIPT_PATH);
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function buildTargetLeadContext() {
  const transcript = readTargetLeadTranscript();
  const areaMatches = findAreasInText(transcript);
  const primaryArea = areaMatches[0] || null;
  const budgetMatch = transcript.match(/budget[^\n\r]*?AED\s*([\d,]+)/i);
  const budgetAed = budgetMatch?.[1]?.replace(/,/g, "") || null;
  const bedroomMatch = transcript.match(/(\d+)[-\s]?(bed|bedroom|br)/i);
  const propertyType = bedroomMatch ? `${bedroomMatch[1]}BR apartment` : null;
  const callBrief = [
    primaryArea?.canonical
      ? `Lead asked about listings in ${primaryArea.canonical}.`
      : null,
    budgetAed ? `Budget is around AED ${Number(budgetAed).toLocaleString()}.` : null,
    propertyType ? `Preferred property type: ${propertyType}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const contextNotes = transcript
    .split("\n")
    .filter((line) => line.toLowerCase().startsWith("lead context:"))
    .map((line) => line.replace(/^Lead Context:\s*/i, "").trim());

  return {
    listing_area: primaryArea?.canonical || null,
    listing_area_code: primaryArea?.shortCode || null,
    listing_area_options: areaMatches.map((a) => a.canonical),
    budget_aed: budgetAed ? Number(budgetAed) : null,
    property_type: propertyType,
    call_brief: callBrief || null,
    context_notes: contextNotes,
  };
}

export function getTargetLead() {
  return { name: TARGET_LEAD_NAME, phoneNumber: TARGET_LEAD_PHONE };
}

export function getTargetLeadContext() {
  return buildTargetLeadContext();
}

export async function startTargetLeadCall() {
  const { apiKey, assistantId, phoneNumberId, baseUrl, createPath } = getVapiConfig();
  const leadContext = buildTargetLeadContext();
  const firstMessageParts = [
    "Hi Shuayb, quick follow-up.",
    leadContext.listing_area
      ? `You asked about listings in ${leadContext.listing_area}.`
      : null,
    leadContext.budget_aed
      ? `Your budget was around AED ${leadContext.budget_aed.toLocaleString()}.`
      : null,
    "I can answer your listing questions directly now.",
  ].filter(Boolean);

  const payload = {
    assistantId,
    phoneNumberId,
    customer: {
      number: TARGET_LEAD_PHONE,
      name: TARGET_LEAD_NAME,
    },
    metadata: {
      leadName: TARGET_LEAD_NAME,
      leadPhone: TARGET_LEAD_PHONE,
      listing_area: leadContext.listing_area,
      listing_area_code: leadContext.listing_area_code,
      listing_area_options: leadContext.listing_area_options,
      budget_aed: leadContext.budget_aed,
      property_type: leadContext.property_type,
      call_brief: leadContext.call_brief,
      source: "agentzero-kb-chat",
    },
    assistantOverrides: {
      variableValues: {
        lead_name: TARGET_LEAD_NAME,
        listing_area: leadContext.listing_area,
        budget_aed: leadContext.budget_aed,
        property_type: leadContext.property_type,
        call_brief: leadContext.call_brief,
        response_style:
          "Answer questions directly. Do not defer to Alex or another person unless explicitly requested.",
      },
      firstMessage: firstMessageParts.join(" "),
    },
  };

  const response = await fetch(`${baseUrl}${createPath}`, {
    method: "POST",
    headers: getAuthHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Vapi call start failed (${response.status}): ${body?.message || "Unknown error"}`
    );
  }

  return {
    callId: body?.id || body?.callId || null,
    status: body?.status || "queued",
    leadContext,
    raw: body,
  };
}

export async function getLatestTargetLeadCallSummary() {
  const { apiKey, baseUrl, callsPath } = getVapiConfig();
  const response = await fetch(`${baseUrl}${callsPath}?limit=30`, {
    method: "GET",
    headers: getAuthHeaders(apiKey),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Vapi calls fetch failed (${response.status}): ${body?.message || "Unknown error"}`
    );
  }

  const calls = Array.isArray(body) ? body : body?.calls || body?.data || [];
  const targetCall = calls.find((call) => {
    const number = call?.customer?.number || call?.to || call?.phoneNumber;
    const name = call?.customer?.name || call?.name || "";
    return (
      number === TARGET_LEAD_PHONE ||
      String(name).toLowerCase().includes("shuayb")
    );
  });

  if (!targetCall) {
    return {
      found: false,
      message: "No Shuayb call found yet. Try again after the call completes.",
    };
  }

  return {
    found: true,
    ...normalizeSummary(targetCall),
  };
}

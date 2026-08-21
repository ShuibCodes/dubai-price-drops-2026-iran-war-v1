import { enquiryClauseForSource } from "@/lib/scripts/enquiry-source";
import { VOICE_ALLOWLIST } from "@/lib/scripts/schema";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getVapiConfig() {
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

function normalizePhoneForVapi(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) throw new Error("Missing phone number for Vapi call");
  if (String(phone || "").trim().startsWith("+")) return `+${digits}`;
  if (digits.startsWith("971")) return `+${digits}`;
  return `+${digits}`;
}

/** Locked on every assistant write. Never from script config. */
export const VAPI_ASSISTANT_LOCK = {
  maxDurationSeconds: 180,
  silenceTimeoutSeconds: 20,
  model: {
    provider: "groq",
    model: "openai/gpt-oss-120b",
  },
  transcriber: {
    provider: "deepgram",
    model: "flux-general-en",
    language: "en",
    confidenceThreshold: 0.4,
    keyterm: [
      "million",
      "dirhams",
      "AED",
      "lakh",
      "crore",
      "Dubai Marina",
      "JVC",
      "Downtown",
      "Business Bay",
      "Damac Hills",
      "Arabian Ranches",
      "Dubai Hills",
      "Palm Jumeirah",
      "JBR",
      "Ellington",
      "Emaar",
      "Damac",
      "Sobha",
      "studio",
      "one bed",
      "two bed",
      "townhouse",
      "villa",
      "off-plan",
      "handover",
      "distressed",
    ],
  },
  startSpeakingPlan: { waitSeconds: 0.2 },
  stopSpeakingPlan: { voiceSeconds: 0.1, backoffSeconds: 1 },
  voicemailDetection: {
    provider: "vapi",
    backoffPlan: {
      maxRetries: 6,
      startAtSeconds: 5,
      frequencySeconds: 5,
    },
    beepMaxAwaitSeconds: 0,
  },
  // Live 1416 Allan firstMessage (dashboard):
  // "Hi my name is Allan, If i continue for 30 seconds will you hang up in my face? or can i continue?"
  // Dropped "Hi my name is Allan," — persona is per-tenant and not on this write.
  // Gate kept verbatim (live casing). Already enquiry-neutral.
  firstMessage:
    "If i continue for 30 seconds will you hang up in my face? or can i continue?",
  firstMessageMode: "assistant-waits-for-user",
};

function getVapiApi() {
  return {
    apiKey: getRequiredEnv("VAPI_API_KEY"),
    baseUrl: process.env.VAPI_BASE_URL || "https://api.vapi.ai",
  };
}

function getVapiPublicKey() {
  const key = String(process.env.VAPI_PUBLIC_KEY || "").trim();
  if (!key) {
    throw new Error(
      "Talk here needs VAPI_PUBLIC_KEY. Copy the Public key from Vapi Dashboard → Organization → API Keys. The private VAPI_API_KEY cannot create web calls on this org."
    );
  }
  return key;
}

function getAssistantServerUrl() {
  const explicit = String(process.env.VAPI_SERVER_URL || "").trim();
  const origin = String(
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ""
  ).trim();
  const raw = explicit || origin;
  if (!raw) {
    throw new Error(
      "VAPI_SERVER_URL or APP_URL is required to write Vapi assistants"
    );
  }
  const trimmed = raw.replace(/\/$/, "");
  if (trimmed.includes("/api/vapi/webhook")) return trimmed;
  return `${trimmed}/api/vapi/webhook`;
}

function resolveVoice(voiceId) {
  const id = String(voiceId || "").trim();
  const entry = VOICE_ALLOWLIST.find((voice) => voice.id === id);
  if (!entry) {
    throw new Error("Assistant voiceId is not on VOICE_ALLOWLIST");
  }
  if (entry.provider === "11labs") {
    return {
      provider: "11labs",
      voiceId: entry.id,
      model: entry.model || "eleven_turbo_v2_5",
    };
  }
  return {
    provider: "vapi",
    voiceId: entry.id,
    version: 2,
  };
}

export function buildVapiAssistantWriteBody({
  name,
  prompt,
  voiceId,
  firstMessage,
}) {
  const displayName = String(name || "").trim();
  const systemPrompt = String(prompt || "");
  if (!displayName) throw new Error("Assistant name is required");
  if (!systemPrompt) throw new Error("Assistant prompt is required");

  const spokenFirst = String(
    firstMessage ?? VAPI_ASSISTANT_LOCK.firstMessage
  ).trim();
  if (!spokenFirst) throw new Error("Assistant firstMessage is required");

  return {
    name: displayName,
    model: {
      ...VAPI_ASSISTANT_LOCK.model,
      messages: [{ role: "system", content: systemPrompt }],
    },
    voice: resolveVoice(voiceId),
    transcriber: VAPI_ASSISTANT_LOCK.transcriber,
    startSpeakingPlan: VAPI_ASSISTANT_LOCK.startSpeakingPlan,
    stopSpeakingPlan: VAPI_ASSISTANT_LOCK.stopSpeakingPlan,
    maxDurationSeconds: VAPI_ASSISTANT_LOCK.maxDurationSeconds,
    silenceTimeoutSeconds: VAPI_ASSISTANT_LOCK.silenceTimeoutSeconds,
    voicemailDetection: VAPI_ASSISTANT_LOCK.voicemailDetection,
    voicemailMessage: "",
    firstMessage: spokenFirst,
    firstMessageMode: VAPI_ASSISTANT_LOCK.firstMessageMode,
    server: {
      url: getAssistantServerUrl(),
      timeoutSeconds: 20,
    },
  };
}

/**
 * Write-only. POST when vapiAssistantId is null, PATCH when set.
 * One attempt. Never GET. Throws on non-2xx with the Vapi body attached.
 *
 * @returns {Promise<string>} assistant id
 */
export async function upsertVapiAssistant({
  vapiAssistantId,
  name,
  prompt,
  voiceId,
  firstMessage,
}) {
  const { apiKey, baseUrl } = getVapiApi();
  const existingId = String(vapiAssistantId || "").trim();
  const method = existingId ? "PATCH" : "POST";
  const url = existingId
    ? `${String(baseUrl).replace(/\/$/, "")}/assistant/${encodeURIComponent(existingId)}`
    : `${String(baseUrl).replace(/\/$/, "")}/assistant`;

  const payload = buildVapiAssistantWriteBody({
    name,
    prompt,
    voiceId,
    firstMessage,
  });

  const response = await fetch(url, {
    method,
    headers: getAuthHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `Vapi assistant ${method} failed (${response.status}): ${
        body?.message || JSON.stringify(body) || "Unknown error"
      }`
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }

  const id = String(body?.id || existingId || "").trim();
  if (!id) {
    const error = new Error("Vapi assistant write returned no id");
    error.body = body;
    throw error;
  }
  return id;
}

function buildAssistantOverrides({
  name,
  variableValues = {},
  prompt,
  voiceId,
  firstMessage,
}) {
  const leadName = String(name || "there").trim() || "there";
  const assistantOverrides = {
    variableValues: {
      lead_name: leadName,
      leadName,
      leadSource: variableValues.leadSource || null,
      propertyInterest: variableValues.propertyInterest || null,
      ...variableValues,
      enquiryClause: enquiryClauseForSource(variableValues.leadSource),
    },
  };

  const systemPrompt = String(prompt || "");
  if (systemPrompt) {
    assistantOverrides.model = {
      ...VAPI_ASSISTANT_LOCK.model,
      messages: [{ role: "system", content: systemPrompt }],
    };
  }
  if (voiceId) {
    assistantOverrides.voice = resolveVoice(voiceId);
  }
  const spokenFirst = String(firstMessage || "").trim();
  if (spokenFirst) {
    assistantOverrides.firstMessage = spokenFirst;
    assistantOverrides.firstMessageMode = VAPI_ASSISTANT_LOCK.firstMessageMode;
  }
  return { leadName, assistantOverrides };
}

function webCallUrlFromBody(body) {
  return (
    String(body?.webCallUrl || "").trim() ||
    String(body?.transport?.callUrl || "").trim() ||
    String(body?.transport?.webCallUrl || "").trim()
  );
}

function webCallTokenFromBody(body) {
  return String(body?.transport?.callToken || body?.callToken || "").trim();
}

export async function startLeadCall({
  name,
  phone,
  assistantId: assistantIdOverride,
  phoneNumberId: phoneNumberIdOverride,
  variableValues = {},
  metadata = {},
  prompt,
  voiceId,
  firstMessage,
}) {
  const { apiKey, assistantId, phoneNumberId, baseUrl, createPath } = getVapiConfig();
  const resolvedAssistantId = assistantIdOverride || assistantId;
  const resolvedPhoneNumberId = phoneNumberIdOverride || phoneNumberId;
  const phoneNumber = normalizePhoneForVapi(phone);
  const { leadName, assistantOverrides } = buildAssistantOverrides({
    name,
    variableValues,
    prompt,
    voiceId,
    firstMessage,
  });

  const payload = {
    assistantId: resolvedAssistantId,
    phoneNumberId: resolvedPhoneNumberId,
    customer: {
      number: phoneNumber,
      name: leadName,
    },
    metadata: {
      leadName,
      leadPhone: phoneNumber,
      ...metadata,
    },
    assistantOverrides,
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
    raw: body,
  };
}

/**
 * In-tab WebRTC test. Same locked firstMessage / prompt / voice as a phone
 * test. Does not dial a number. Caller must not put the prompt in the browser —
 * only the returned webCallUrl is joinable.
 */
export async function startWebCall({
  name,
  assistantId: assistantIdOverride,
  variableValues = {},
  metadata = {},
  prompt,
  voiceId,
  firstMessage,
}) {
  const publicKey = getVapiPublicKey();
  const baseUrl = process.env.VAPI_BASE_URL || "https://api.vapi.ai";
  const fallbackId = String(process.env.VAPI_ASSISTANT_ID || "").trim();
  const resolvedAssistantId = String(assistantIdOverride || fallbackId || "").trim();
  if (!resolvedAssistantId) throw new Error("Assistant id is required");

  const { assistantOverrides } = buildAssistantOverrides({
    name,
    variableValues,
    prompt,
    voiceId,
    firstMessage,
  });

  const payload = {
    assistantId: resolvedAssistantId,
    assistantOverrides,
  };

  // /call is phone-only on this org (requires phoneNumberId). /call/web is
  // the public-key endpoint — the private VAPI_API_KEY 401s here.
  const response = await fetch(`${String(baseUrl).replace(/\/$/, "")}/call/web`, {
    method: "POST",
    headers: getAuthHeaders(publicKey),
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Vapi web call start failed (${response.status}): ${body?.message || "Unknown error"}`
    );
  }

  const webCallUrl = webCallUrlFromBody(body);
  if (!webCallUrl) {
    throw new Error("Vapi web call returned no join URL");
  }
  const callToken = webCallTokenFromBody(body);

  return {
    callId: body?.id || body?.callId || null,
    status: body?.status || "queued",
    webCallUrl,
    callToken: callToken || null,
    raw: body,
  };
}

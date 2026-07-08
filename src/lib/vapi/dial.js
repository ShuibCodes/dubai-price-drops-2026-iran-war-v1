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

export async function startLeadCall({
  name,
  phone,
  assistantId: assistantIdOverride,
  phoneNumberId: phoneNumberIdOverride,
  variableValues = {},
  metadata = {},
  firstMessage,
}) {
  const { apiKey, assistantId, phoneNumberId, baseUrl, createPath } = getVapiConfig();
  const resolvedAssistantId = assistantIdOverride || assistantId;
  const resolvedPhoneNumberId = phoneNumberIdOverride || phoneNumberId;
  const leadName = String(name || "there").trim() || "there";
  const phoneNumber = normalizePhoneForVapi(phone);

  const defaultFirstMessage = [
    `Hi ${leadName}, this is AgentZero calling about your property enquiry.`,
    variableValues.propertyInterest
      ? `You were looking at ${variableValues.propertyInterest}.`
      : null,
    variableValues.leadSource
      ? `I see you came from ${variableValues.leadSource}.`
      : null,
    "I have a few quick questions to help match you with the right options.",
  ]
    .filter(Boolean)
    .join(" ");

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
    assistantOverrides: {
      variableValues: {
        lead_name: leadName,
        leadName,
        leadSource: variableValues.leadSource || null,
        propertyInterest: variableValues.propertyInterest || null,
        ...variableValues,
      },
      firstMessage: firstMessage || defaultFirstMessage,
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
    raw: body,
  };
}

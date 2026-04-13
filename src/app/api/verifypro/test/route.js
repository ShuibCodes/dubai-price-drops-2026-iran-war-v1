import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VAPI_BASE = "https://api.vapi.ai";

async function checkVapiAssistant(apiKey, assistantId) {
  try {
    const res = await fetch(`${VAPI_BASE}/assistant/${assistantId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 404) return { ok: false, reason: "Assistant ID not found in Vapi" };
    if (res.status === 401) return { ok: false, reason: "Invalid VAPI_API_KEY" };
    if (!res.ok) return { ok: false, reason: `Vapi responded with ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Cannot reach Vapi API: ${err.message}` };
  }
}

async function checkVapiPhoneNumber(apiKey, phoneNumberId) {
  try {
    const res = await fetch(`${VAPI_BASE}/phone-number/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 404) return { ok: false, reason: "Phone number ID not found in Vapi" };
    if (!res.ok) return { ok: false, reason: `Vapi phone check responded with ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Cannot reach Vapi API: ${err.message}` };
  }
}

export async function GET() {
  const checks = {
    VAPI_API_KEY: Boolean(process.env.VAPI_API_KEY),
    VAPI_ASSISTANT_ID: Boolean(process.env.VAPI_ASSISTANT_ID),
    VAPI_PHONE_NUMBER_ID: Boolean(process.env.VAPI_PHONE_NUMBER_ID),
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
    RESEND_FROM_EMAIL: Boolean(process.env.RESEND_FROM_EMAIL),
    RAPIDAPI_KEY: Boolean(process.env.RAPIDAPI_KEY),
  };

  const missingEnv = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missingEnv.length > 0) {
    return NextResponse.json({
      ok: false,
      checks,
      error: `Missing env vars: ${missingEnv.join(", ")}`,
      vapiAssistant: null,
      vapiPhone: null,
    });
  }

  const [assistantCheck, phoneCheck] = await Promise.all([
    checkVapiAssistant(process.env.VAPI_API_KEY, process.env.VAPI_ASSISTANT_ID),
    checkVapiPhoneNumber(process.env.VAPI_API_KEY, process.env.VAPI_PHONE_NUMBER_ID),
  ]);

  const vapiOk = assistantCheck.ok && phoneCheck.ok;

  return NextResponse.json({
    ok: vapiOk && missingEnv.length === 0,
    checks,
    vapiAssistant: assistantCheck,
    vapiPhone: phoneCheck,
    error: !vapiOk
      ? [!assistantCheck.ok && assistantCheck.reason, !phoneCheck.ok && phoneCheck.reason]
          .filter(Boolean)
          .join(" · ")
      : null,
    testPhone: "+971585690693",
    timestamp: new Date().toISOString(),
  });
}

import twilio from "twilio";
import { defaultKbState, runKbTurn } from "@/lib/kb/engine";
import { JARVIS_TENANT_SLUG, runJarvisTurn } from "@/lib/jarvis/engine";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  getSenderState,
  hasProcessedMessageSid,
  markProcessedMessageSid,
  setSenderState,
} from "@/lib/whatsapp/state-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_REPLY_LENGTH = 1500;

function makeTwiml(text = "") {
  const response = new twilio.twiml.MessagingResponse();
  const safe = String(text || "").trim();
  if (safe) {
    response.message(safe.slice(0, MAX_REPLY_LENGTH));
  }
  return response.toString();
}

function xmlResponse(xml) {
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function truncateForWhatsApp(text) {
  const body = String(text || "").trim();
  if (body.length <= MAX_REPLY_LENGTH) return body;
  const tail = "\n\n(truncated — ask for more)";
  return `${body.slice(0, MAX_REPLY_LENGTH - tail.length)}${tail}`;
}

function jarvisWaIds() {
  return String(process.env.JARVIS_WHATSAPP_WA_IDS || "")
    .split(",")
    .map((value) => value.replace(/\D/g, ""))
    .filter(Boolean);
}

async function resolveJarvisTenant() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", JARVIS_TENANT_SLUG)
    .maybeSingle();
  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  if (!tenant) throw new Error(`Tenant ${JARVIS_TENANT_SLUG} not found`);
  return tenant;
}

export async function GET() {
  return Response.json({
    ok: true,
    message: "Twilio WhatsApp webhook is healthy.",
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    jarvisWaIds: jarvisWaIds().length,
  });
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const from = String(form.get("From") || "").trim();
    const body = String(form.get("Body") || "").trim();
    const messageSid = String(form.get("MessageSid") || "").trim();

    if (!from) {
      return xmlResponse(makeTwiml(""));
    }

    if (messageSid && hasProcessedMessageSid(from, messageSid)) {
      return xmlResponse(makeTwiml(""));
    }

    if (!body) {
      if (messageSid) markProcessedMessageSid(from, messageSid);
      return xmlResponse(makeTwiml("I only handle text messages for now."));
    }

    const state = getSenderState(from) ?? defaultKbState();
    const previousMessages = Array.isArray(state.messages) ? state.messages : [];
    const nextMessages = [...previousMessages, { role: "user", content: body }].slice(-30);

    const callerWaId = from.replace(/^whatsapp:/i, "").replace(/\D/g, "");
    const useJarvis = callerWaId && jarvisWaIds().includes(callerWaId);

    let replyText;
    let nextState = state;

    if (useJarvis) {
      const tenant = await resolveJarvisTenant();
      const result = await runJarvisTurn({
        tenantId: tenant.id,
        messages: nextMessages,
        agentName: "Shuayb",
      });
      replyText = truncateForWhatsApp(result.text);
      nextState = {
        ...state,
        mode: "jarvis",
        messages: [...nextMessages, { role: "assistant", content: replyText }].slice(-30),
      };
    } else {
      const result = await runKbTurn({
        messages: nextMessages,
        state,
        callerWaId: callerWaId || null,
      });
      replyText = truncateForWhatsApp(result.text);
      nextState = {
        ...(result.nextState ?? state),
        messages: [...nextMessages, { role: "assistant", content: replyText }].slice(-30),
      };
    }

    setSenderState(from, nextState);
    if (messageSid) {
      markProcessedMessageSid(from, messageSid);
    }

    return xmlResponse(makeTwiml(replyText));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("WhatsApp webhook error:", message, error);
    if (message.includes("Missing ANTHROPIC_API_KEY")) {
      console.error("Set ANTHROPIC_API_KEY in Vercel project environment variables.");
    }
    return xmlResponse(
      makeTwiml("I hit a temporary issue. Please try again in a moment.")
    );
  }
}

import twilio from "twilio";
import { defaultKbState, runKbTurn } from "@/lib/kb/engine";
import {
  getSenderState,
  hasProcessedMessageSid,
  markProcessedMessageSid,
  setSenderState,
} from "@/lib/whatsapp/state-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_REPLY_LENGTH = 1200;

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

export async function GET() {
  return Response.json({
    ok: true,
    message: "Twilio WhatsApp webhook is healthy.",
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

    const result = await runKbTurn({
      messages: nextMessages,
      state,
    });

    const persistedState = {
      ...(result.nextState ?? state),
      messages: [...nextMessages, { role: "assistant", content: result.text }].slice(-30),
    };
    setSenderState(from, persistedState);
    if (messageSid) {
      markProcessedMessageSid(from, messageSid);
    }

    return xmlResponse(makeTwiml(result.text));
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return xmlResponse(
      makeTwiml("I hit a temporary issue. Please try again in a moment.")
    );
  }
}

import twilio from "twilio";
import { waitUntil } from "@vercel/functions";
import { defaultKbState, runKbTurn } from "@/lib/kb/engine";
import { runJarvisTurn } from "@/lib/jarvis/engine";
import { handleContactConfirmationMessage } from "@/lib/jarvis/contacts";
import { getPendingContact } from "@/lib/jarvis/pending-contact";
import { getPendingRelay } from "@/lib/jarvis/pending-relay";
import { handleRelayConfirmationMessage } from "@/lib/jarvis/relay";
import { resolveJarvisSender } from "@/lib/jarvis/resolve-sender";
import {
  getSenderState,
  hasProcessedMessageSid,
  markProcessedMessageSid,
  setSenderState,
} from "@/lib/whatsapp/state-store";
import {
  sendWhatsAppText,
  truncateWhatsAppBody,
  twilioRestConfigured,
} from "@/lib/whatsapp/twilio-send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

const TEMPORARY_FAILURE_REPLY =
  "I hit a temporary issue. Please try again in a moment.";
const ANTHROPIC_CREDITS_REPLY =
  "AgentZero is out of Anthropic credits. Add credits in Anthropic Billing, then try again.";

function failureReply(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (
    /credit balance is too low|purchase credits|plans\s*&\s*billing/i.test(
      message
    )
  ) {
    return ANTHROPIC_CREDITS_REPLY;
  }
  return TEMPORARY_FAILURE_REPLY;
}

function makeTwiml(text = "") {
  const response = new twilio.twiml.MessagingResponse();
  const safe = String(text || "").trim();
  if (safe) {
    response.message(safe);
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

async function runJarvisAndReply({
  from,
  to,
  nextMessages,
  state,
  messageSid,
  userText,
  sender,
}) {
  try {
    const senderPhone = sender.waId;

    const contactConfirm = await handleContactConfirmationMessage({
      tenantId: sender.tenantId,
      senderPhone,
      message: userText,
    });
    if (contactConfirm?.handled) {
      const replyText = truncateWhatsAppBody(contactConfirm.text);
      await sendWhatsAppText({ to: from, from: to, body: replyText });
      setSenderState(from, {
        ...state,
        mode: "jarvis",
        messages: [
          ...nextMessages,
          { role: "assistant", content: replyText },
        ].slice(-30),
      });
      return;
    }

    const relayConfirm = await handleRelayConfirmationMessage({
      tenantId: sender.tenantId,
      senderPhone,
      message: userText,
    });
    if (relayConfirm?.handled) {
      const replyText = truncateWhatsAppBody(relayConfirm.text);
      await sendWhatsAppText({ to: from, from: to, body: replyText });
      setSenderState(from, {
        ...state,
        mode: "jarvis",
        messages: [
          ...nextMessages,
          { role: "assistant", content: replyText },
        ].slice(-30),
      });
      return;
    }

    const result = await runJarvisTurn({
      tenantId: sender.tenantId,
      messages: nextMessages,
      agentName: sender.agentName,
      senderPhone,
    });
    const replyText = truncateWhatsAppBody(result.text);
    await sendWhatsAppText({ to: from, from: to, body: replyText });
    const pendingRelay = await getPendingRelay(senderPhone).catch(() => null);
    const pendingContact = await getPendingContact(senderPhone).catch(() => null);
    setSenderState(from, {
      ...state,
      mode: "jarvis",
      pendingRelay,
      pendingContact,
      messages: [...nextMessages, { role: "assistant", content: replyText }].slice(
        -30
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("WhatsApp Jarvis async error:", message, error);
    try {
      await sendWhatsAppText({
        to: from,
        from: to,
        body: failureReply(error),
      });
    } catch (sendError) {
      console.error("WhatsApp Jarvis failure reply failed:", sendError);
    }
  } finally {
    if (messageSid) {
      markProcessedMessageSid(from, messageSid);
    }
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    message: "Twilio WhatsApp webhook is healthy.",
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    jarvisRouting: "agents.wa_id",
    twilioRestConfigured: twilioRestConfigured(),
  });
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const from = String(form.get("From") || "").trim();
    const to = String(form.get("To") || "").trim();
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
    const nextMessages = [...previousMessages, { role: "user", content: body }].slice(
      -30
    );

    const callerWaId = from.replace(/^whatsapp:/i, "").replace(/\D/g, "");
    const sender = callerWaId ? await resolveJarvisSender(callerWaId) : null;
    const useJarvis = Boolean(sender);
    if (sender) {
      console.info(
        `[whatsapp] jarvis sender=${sender.waId} tenant=${sender.tenantSlug}`
      );
    }

    if (useJarvis && twilioRestConfigured() && to) {
      if (messageSid) markProcessedMessageSid(from, messageSid);
      waitUntil(
        runJarvisAndReply({
          from,
          to,
          nextMessages,
          state,
          messageSid: null,
          userText: body,
          sender,
        })
      );
      return xmlResponse(makeTwiml(""));
    }

    if (useJarvis && !twilioRestConfigured()) {
      console.warn(
        "Jarvis WhatsApp: TWILIO_ACCOUNT_SID/AUTH_TOKEN missing — falling back to sync TwiML (Twilio ~15s risk)."
      );
    }

    let replyText;
    let nextState = state;

    if (useJarvis) {
      const contactConfirm = await handleContactConfirmationMessage({
        tenantId: sender.tenantId,
        senderPhone: sender.waId,
        message: body,
      });
      if (contactConfirm?.handled) {
        replyText = truncateWhatsAppBody(contactConfirm.text);
      } else {
        const relayConfirm = await handleRelayConfirmationMessage({
          tenantId: sender.tenantId,
          senderPhone: sender.waId,
          message: body,
        });
        if (relayConfirm?.handled) {
          replyText = truncateWhatsAppBody(relayConfirm.text);
        } else {
          const result = await runJarvisTurn({
            tenantId: sender.tenantId,
            messages: nextMessages,
            agentName: sender.agentName,
            senderPhone: sender.waId,
          });
          replyText = truncateWhatsAppBody(result.text);
        }
      }
      nextState = {
        ...state,
        mode: "jarvis",
        messages: [...nextMessages, { role: "assistant", content: replyText }].slice(
          -30
        ),
      };
    } else {
      const result = await runKbTurn({
        messages: nextMessages,
        state,
        callerWaId: callerWaId || null,
      });
      replyText = truncateWhatsAppBody(result.text);
      nextState = {
        ...(result.nextState ?? state),
        messages: [...nextMessages, { role: "assistant", content: replyText }].slice(
          -30
        ),
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
    return xmlResponse(makeTwiml(failureReply(error)));
  }
}

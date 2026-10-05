import twilio from "twilio";
import { waitUntil } from "@vercel/functions";
import { defaultKbState, runKbTurn } from "@/lib/kb/engine";
import { runJarvisTurn } from "@/lib/jarvis/engine";
import { handleContactConfirmationMessage } from "@/lib/jarvis/contacts";
import { getPendingContact } from "@/lib/jarvis/pending-contact";
import { getPendingRelay } from "@/lib/jarvis/pending-relay";
import { handleRelayConfirmationMessage } from "@/lib/jarvis/relay";
import { withJarvisConversation } from "@/lib/jarvis/conversation";
import { resolveJarvisSender } from "@/lib/jarvis/resolve-sender";
import {
  getSenderState,
  hasProcessedMessageSid,
  markProcessedMessageSid,
  setSenderState,
} from "@/lib/whatsapp/state-store";
import {
  sendWhatsAppText,
  plainJarvisWhatsAppText,
  truncateWhatsAppBody,
  twilioRestConfigured,
} from "@/lib/whatsapp/twilio-send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

const TEMPORARY_FAILURE_REPLY =
  "I hit a temporary issue. Please try again in a moment.";
const ANTHROPIC_CREDITS_REPLY =
  "AgentZero is out of credits. Add credits in billing, then try again.";

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

async function composeJarvisReply(sender, userText, messages) {
  const senderPhone = sender.waId;
  const contactConfirm = await handleContactConfirmationMessage({
    tenantId: sender.tenantId,
    agentId: sender.agentId,
    senderPhone,
    message: userText,
  });
  if (contactConfirm?.handled) return truncateWhatsAppBody(contactConfirm.text);

  const relayConfirm = await handleRelayConfirmationMessage({
    tenantId: sender.tenantId,
    agentId: sender.agentId,
    senderPhone,
    message: userText,
  });
  if (relayConfirm?.handled) return truncateWhatsAppBody(relayConfirm.text);

  const result = await runJarvisTurn({
    tenantId: sender.tenantId,
    agentId: sender.agentId,
    messages,
    agentName: sender.agentName,
    senderPhone,
  });
  return truncateWhatsAppBody(plainJarvisWhatsAppText(result.text));
}

async function replyWithDurableHistory({
  from,
  sender,
  userText,
  messageSid,
  state,
  deliver,
}) {
  const outcome = await withJarvisConversation({
    tenantId: sender.tenantId,
    agentId: sender.agentId,
    senderPhone: sender.waId,
    messageSid,
    userText,
    run: (messages) => composeJarvisReply(sender, userText, messages),
    deliver,
  });
  const pendingRelay = await getPendingRelay(sender.waId).catch(() => null);
  const pendingContact = await getPendingContact(sender.waId).catch(() => null);
  setSenderState(from, {
    ...state,
    pendingRelay,
    pendingContact,
  });
  return outcome;
}

async function runJarvisAndReply({
  from,
  to,
  state,
  messageSid,
  userText,
  sender,
}) {
  try {
    await replyWithDurableHistory({
      from,
      sender,
      userText,
      messageSid,
      state,
      deliver: async (text) => {
        await sendWhatsAppText({ to: from, from: to, body: text });
      },
    });
  } catch (error) {
    // A failed WhatsApp send is caught inside the conversation turn and leaves
    // sent_at unset. This catch is for model and lease failures, so it does not
    // also send a generic failure after the saved answer.
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
      // Known Jarvis duplicates are decided by the durable MessageSid row.
      // Marking the sid here would drop a same-process retry of an unsent turn.
      waitUntil(
        runJarvisAndReply({
          from,
          to,
          state,
          messageSid,
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

    let replyText = "";
    let nextState = state;

    if (useJarvis) {
      const outcome = await replyWithDurableHistory({
        from,
        sender,
        userText: body,
        messageSid,
        state,
        deliver: async (text) => {
          replyText = text;
        },
      });
      if (!replyText && outcome?.text && !outcome.duplicate && !outcome.abandoned) {
        replyText = outcome.text;
      }
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

    if (!useJarvis) {
      setSenderState(from, nextState);
      if (messageSid) markProcessedMessageSid(from, messageSid);
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

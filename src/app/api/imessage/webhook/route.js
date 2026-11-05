import { waitUntil } from "@vercel/functions";
import { defaultKbState, runKbTurn } from "@/lib/kb/engine";
import { runJarvisTurn } from "@/lib/jarvis/engine";
import { handleContactConfirmationMessage } from "@/lib/jarvis/contacts";
import { getPendingContact } from "@/lib/jarvis/pending-contact";
import { getPendingRelay } from "@/lib/jarvis/pending-relay";
import { handleRelayConfirmationMessage } from "@/lib/jarvis/relay";
import { withJarvisConversation } from "@/lib/jarvis/conversation";
import { resolveJarvisSender } from "@/lib/jarvis/resolve-sender";
import { bindAgentZeroInboundTo } from "@/lib/jarvis/self-chat";
import {
  getSenderState,
  hasProcessedMessageSid,
  markProcessedMessageSid,
  setSenderState,
} from "@/lib/whatsapp/state-store";
import {
  sendIMessageText,
  plainJarvisIMessageText,
  truncateIMessageBody,
  sendblueConfigured,
} from "@/lib/imessage/send";

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

async function composeJarvisReply(sender, userText, messages) {
  const senderPhone = sender.waId;
  const contactConfirm = await handleContactConfirmationMessage({
    tenantId: sender.tenantId,
    agentId: sender.agentId,
    senderPhone,
    message: userText,
  });
  if (contactConfirm?.handled) return truncateIMessageBody(contactConfirm.text);

  const relayConfirm = await handleRelayConfirmationMessage({
    tenantId: sender.tenantId,
    agentId: sender.agentId,
    senderPhone,
    message: userText,
  });
  if (relayConfirm?.handled) return truncateIMessageBody(relayConfirm.text);

  const result = await runJarvisTurn({
    tenantId: sender.tenantId,
    agentId: sender.agentId,
    messages,
    agentName: sender.agentName,
    senderPhone,
  });
  return truncateIMessageBody(plainJarvisIMessageText(result.text));
}

async function replyWithDurableHistory({
  from,
  to,
  sender,
  userText,
  messageSid,
  state,
  deliver,
}) {
  const outcome = await bindAgentZeroInboundTo(to, () =>
    withJarvisConversation({
      tenantId: sender.tenantId,
      agentId: sender.agentId,
      senderPhone: sender.waId,
      messageSid,
      userText,
      run: (messages) => composeJarvisReply(sender, userText, messages),
      deliver,
    })
  );
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
      to,
      sender,
      userText,
      messageSid,
      state,
      deliver: async (text) => {
        await sendIMessageText({ to: from, from: to, body: text });
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("iMessage Jarvis async error:", message, error);
    try {
      await sendIMessageText({
        to: from,
        from: to,
        body: failureReply(error),
      });
    } catch (sendError) {
      console.error("iMessage Jarvis failure reply failed:", sendError);
    }
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    service: "AgentZero iMessage Webhook (Sendblue)",
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    sendblueConfigured: sendblueConfigured(),
    assignedNumber: process.env.SENDBLUE_NUMBER || null,
  });
}

export async function POST(request) {
  try {
    const payload = await request.json();

    // Ignore Sendblue echoes of outbound messages
    if (payload.is_outbound) {
      return Response.json({ ok: true, status: "ignored_outbound" });
    }

    const from = String(payload.from_number || payload.from || "").trim();
    const to = String(payload.to_number || payload.to || process.env.SENDBLUE_NUMBER || "").trim();
    const body = String(payload.content || payload.text || payload.body || "").trim();
    const messageSid = String(payload.message_handle || payload.id || "").trim();

    if (!from) {
      return Response.json({ ok: true, status: "missing_sender" });
    }

    if (messageSid && hasProcessedMessageSid(from, messageSid)) {
      return Response.json({ ok: true, status: "duplicate" });
    }

    if (!body) {
      if (messageSid) markProcessedMessageSid(from, messageSid);
      return Response.json({ ok: true, status: "empty_body" });
    }

    const state = getSenderState(from) ?? defaultKbState();
    const previousMessages = Array.isArray(state.messages) ? state.messages : [];
    const nextMessages = [...previousMessages, { role: "user", content: body }].slice(-30);

    const sender = await resolveJarvisSender(from, { channel: "imessage" });
    const useJarvis = Boolean(sender);

    if (sender) {
      console.info(
        `[imessage] jarvis sender=${sender.waId} agent=${sender.agentName} tenant=${sender.tenantSlug}`
      );
    }

    if (!sendblueConfigured()) {
      console.warn("Jarvis iMessage: SENDBLUE credentials missing.");
      return Response.json({ ok: false, error: "Sendblue not configured" }, { status: 500 });
    }

    if (useJarvis) {
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
      return Response.json({ ok: true, status: "queued_jarvis" });
    }

    // Fallback KB chatbot if sender is not a registered agent
    waitUntil(
      (async () => {
        try {
          const callerDigits = from.replace(/\D/g, "");
          const result = await runKbTurn({
            messages: nextMessages,
            state,
            callerWaId: callerDigits || null,
          });
          const replyText = truncateIMessageBody(result.text);
          const nextState = {
            ...(result.nextState ?? state),
            messages: [...nextMessages, { role: "assistant", content: replyText }].slice(-30),
          };
          setSenderState(from, nextState);
          if (messageSid) markProcessedMessageSid(from, messageSid);
          await sendIMessageText({ to: from, from: to, body: replyText });
        } catch (err) {
          console.error("iMessage KB fallback error:", err);
        }
      })()
    );

    return Response.json({ ok: true, status: "queued_kb" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("iMessage webhook error:", message, error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

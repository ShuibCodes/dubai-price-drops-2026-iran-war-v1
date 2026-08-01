import twilio from "twilio";
import { waitUntil } from "@vercel/functions";
import { defaultKbState, runKbTurn } from "@/lib/kb/engine";
import { JARVIS_TENANT_SLUG, runJarvisTurn } from "@/lib/jarvis/engine";
import { handleContactConfirmationMessage } from "@/lib/jarvis/contacts";
import { getPendingContact } from "@/lib/jarvis/pending-contact";
import { getPendingRelay } from "@/lib/jarvis/pending-relay";
import { handleRelayConfirmationMessage } from "@/lib/jarvis/relay";
import { getSupabaseServerClient } from "@/lib/supabase/server";
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

async function runJarvisAndReply({
  from,
  to,
  nextMessages,
  state,
  messageSid,
  userText,
}) {
  try {
    const tenant = await resolveJarvisTenant();
    const senderPhone = from.replace(/^whatsapp:/i, "").replace(/\D/g, "");

    // Pending confirmations live in Supabase (not in-memory) so "yes"
    // on a later webhook invocation still finds them.
    const contactConfirm = await handleContactConfirmationMessage({
      tenantId: tenant.id,
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
      tenantId: tenant.id,
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
      tenantId: tenant.id,
      messages: nextMessages,
      agentName: "Shuayb",
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
        body: "I hit a temporary issue. Please try again in a moment.",
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
    jarvisWaIds: jarvisWaIds().length,
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
    const useJarvis = callerWaId && jarvisWaIds().includes(callerWaId);

    if (useJarvis && twilioRestConfigured() && to) {
      // Ack Twilio immediately; finish Jarvis + REST reply in waitUntil (up to maxDuration).
      if (messageSid) markProcessedMessageSid(from, messageSid);
      waitUntil(
        runJarvisAndReply({
          from,
          to,
          nextMessages,
          state,
          messageSid: null, // already marked above
          userText: body,
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
      const tenant = await resolveJarvisTenant();
      const contactConfirm = await handleContactConfirmationMessage({
        tenantId: tenant.id,
        senderPhone: callerWaId,
        message: body,
      });
      if (contactConfirm?.handled) {
        replyText = truncateWhatsAppBody(contactConfirm.text);
      } else {
        const relayConfirm = await handleRelayConfirmationMessage({
          tenantId: tenant.id,
          senderPhone: callerWaId,
          message: body,
        });
        if (relayConfirm?.handled) {
          replyText = truncateWhatsAppBody(relayConfirm.text);
        } else {
          const result = await runJarvisTurn({
            tenantId: tenant.id,
            messages: nextMessages,
            agentName: "Shuayb",
            senderPhone: callerWaId,
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
    return xmlResponse(
      makeTwiml("I hit a temporary issue. Please try again in a moment.")
    );
  }
}

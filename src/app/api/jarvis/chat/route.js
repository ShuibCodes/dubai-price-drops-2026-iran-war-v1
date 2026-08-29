import { handleContactConfirmationMessage } from "@/lib/jarvis/contacts";
import { runJarvisTurn } from "@/lib/jarvis/engine";
import { handleRelayConfirmationMessage } from "@/lib/jarvis/relay";
import { resolveJarvisSender } from "@/lib/jarvis/resolve-sender";
import { timingSafeEqual } from "@/lib/security/timing-safe";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifyAccess(request) {
  const expected = process.env.JARVIS_ACCESS_KEY;
  if (!expected) return process.env.NODE_ENV !== "production";
  return timingSafeEqual(request.headers.get("x-jarvis-key"), expected);
}

function defaultJarvisSenderPhone() {
  return String(process.env.JARVIS_WHATSAPP_WA_IDS || "")
    .split(",")
    .map((value) => value.replace(/\D/g, ""))
    .filter(Boolean)[0] || null;
}

export async function POST(request) {
  try {
    if (!verifyAccess(request)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return Response.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.messages)) {
      return Response.json({ error: "messages must be an array" }, { status: 400 });
    }

    const requestedPhone = String(body.senderPhone || "").replace(/\D/g, "");
    const senderPhone = requestedPhone || defaultJarvisSenderPhone();
    if (!senderPhone) {
      return Response.json(
        { error: "senderPhone is required." },
        { status: 400 }
      );
    }
    const sender = await resolveJarvisSender(senderPhone);
    if (!sender) {
      return Response.json(
        { error: "Unknown AgentZero sender. This WhatsApp number is not on an agent." },
        { status: 403 }
      );
    }

    const tenantId = sender.tenantId;
    const agentName = String(body.agentName || "").trim() || sender.agentName;

    const latestUser = [...body.messages]
      .reverse()
      .find((message) => message?.role === "user");
    const latestText = String(latestUser?.content || "");

    const contactConfirm = await handleContactConfirmationMessage({
      tenantId,
      senderPhone,
      message: latestText,
    });
    if (contactConfirm?.handled) {
      return Response.json({ message: contactConfirm.text });
    }

    const relayConfirm = await handleRelayConfirmationMessage({
      tenantId,
      senderPhone,
      message: latestText,
    });
    if (relayConfirm?.handled) {
      return Response.json({ message: relayConfirm.text });
    }

    const result = await runJarvisTurn({
      tenantId,
      messages: body.messages,
      agentName,
      senderPhone,
    });

    return Response.json({ message: result.text });
  } catch (error) {
    console.error("[jarvis/chat]", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

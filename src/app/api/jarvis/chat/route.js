import { handleContactConfirmationMessage } from "@/lib/jarvis/contacts";
import { JARVIS_TENANT_SLUG, runJarvisTurn } from "@/lib/jarvis/engine";
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

async function resolveSlugTenant(supabase, slug) {
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  return tenant || null;
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
    const sender = senderPhone ? await resolveJarvisSender(senderPhone) : null;

    let tenantId = null;
    let agentName = String(body.agentName || "").trim();

    if (sender) {
      tenantId = sender.tenantId;
      if (!agentName) agentName = sender.agentName;
    } else if (requestedPhone) {
      return Response.json(
        { error: "Unknown AgentZero sender. This WhatsApp number is not on an agent." },
        { status: 403 }
      );
    } else {
      const tenant = await resolveSlugTenant(supabase, JARVIS_TENANT_SLUG);
      if (!tenant) {
        return Response.json(
          { error: `Tenant ${JARVIS_TENANT_SLUG} not found` },
          { status: 404 }
        );
      }
      tenantId = tenant.id;
      if (!agentName) agentName = "Jarvis user";
    }

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

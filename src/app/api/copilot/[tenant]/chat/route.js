import { runCopilotTurn } from "@/lib/copilot/engine";
import {
  COPILOT_SESSION_COOKIE,
  verifyCopilotSessionToken,
} from "@/lib/copilot-auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request, { params }) {
  try {
    const sessionToken = request.cookies.get(COPILOT_SESSION_COOKIE)?.value;
    if (!sessionToken || !verifyCopilotSessionToken(sessionToken)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const slug = String(params?.tenant || "").trim();
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return Response.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, name, slug")
      .eq("slug", slug)
      .maybeSingle();
    if (tenantError) throw new Error(`Tenant lookup failed: ${tenantError.message}`);
    if (!tenant) return Response.json({ error: "Tenant not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.messages)) {
      return Response.json({ error: "messages must be an array" }, { status: 400 });
    }

    const result = await runCopilotTurn({
      tenantId: tenant.id,
      tenantName: tenant.name || tenant.slug,
      messages: body.messages,
      agentName: String(body.agentName || "").trim() || "Team member",
    });

    return Response.json({ message: result.text });
  } catch (error) {
    console.error("[copilot/chat]", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

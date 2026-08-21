import { runCopilotTurn } from "@/lib/copilot/engine";
import { getSession } from "@/lib/copilot/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request, { params }) {
  try {
    const slug = String(params?.tenant || "").trim();
    let session;
    try {
      session = await getSession(request, { tenantSlug: slug });
    } catch (error) {
      if (error.status === 403) {
        return Response.json({ error: "Forbidden for this tenant." }, { status: 403 });
      }
      throw error;
    }
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return Response.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, name, slug")
      .eq("id", session.tenantId)
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

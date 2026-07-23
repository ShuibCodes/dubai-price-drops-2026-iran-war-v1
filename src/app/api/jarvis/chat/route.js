import { JARVIS_TENANT_SLUG, runJarvisTurn } from "@/lib/jarvis/engine";
import { timingSafeEqual } from "@/lib/security/timing-safe";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifyAccess(request) {
  const expected = process.env.JARVIS_ACCESS_KEY;
  // No key configured: open in dev only, locked in production.
  if (!expected) return process.env.NODE_ENV !== "production";
  return timingSafeEqual(request.headers.get("x-jarvis-key"), expected);
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

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, name, slug")
      .eq("slug", JARVIS_TENANT_SLUG)
      .maybeSingle();
    if (tenantError) throw new Error(`Tenant lookup failed: ${tenantError.message}`);
    if (!tenant) {
      return Response.json({ error: "Tenant 1416 not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.messages)) {
      return Response.json({ error: "messages must be an array" }, { status: 400 });
    }

    const result = await runJarvisTurn({
      tenantId: tenant.id,
      messages: body.messages,
      agentName: String(body.agentName || "").trim() || "Jarvis user",
    });

    return Response.json({ message: result.text });
  } catch (error) {
    console.error("[jarvis/chat]", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

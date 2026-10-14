import { timingSafeEqual } from "@/lib/security/timing-safe";
import { getEgmSupabase, handleNewCallbackRequest } from "@/lib/callbacks/egm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Supabase Database Webhook target for EGM Trading `callback_requests` INSERTs.
 * Body is Supabase's standard { type, table, schema, record, old_record }.
 */
function verifySecret(request) {
  const expected = process.env.EGM_CALLBACK_SECRET;
  if (!expected) return false;
  return timingSafeEqual(request.headers.get("x-callback-secret"), expected);
}

export async function POST(request) {
  if (!verifySecret(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (body?.type && body.type !== "INSERT") {
    return Response.json({ ok: true, skipped: true, reason: `ignored ${body.type}` });
  }

  const supabase = getEgmSupabase();
  if (!supabase) {
    return Response.json({ ok: false, error: "EGM Supabase not configured" }, { status: 500 });
  }

  try {
    const result = await handleNewCallbackRequest(supabase, body?.record);
    return Response.json(result);
  } catch (error) {
    console.error("[callbacks/egm] error:", error.message);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

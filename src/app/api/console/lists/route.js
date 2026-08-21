import { consoleContext, jsonError } from "@/lib/console/http";
import { listSavedLists, upsertListContacts } from "@/lib/console/lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const lists = await listSavedLists(ctx.supabase, ctx.session.tenantId);
    return Response.json({ lists });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const body = await request.json().catch(() => ({}));
    const result = await upsertListContacts(ctx.supabase, ctx.session.tenantId, {
      name: body.name,
      contacts: body.contacts,
    });
    if (!result.saved) {
      return jsonError("No numbers could be saved from that file.", 400);
    }
    return Response.json({
      ok: true,
      name: result.name,
      saved: result.saved,
      skipped: result.skipped,
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

import {
    jsonError,
    loadTenant,
    loadTenantScript,
    migratedWriteBlocked,
    requireAdmin,
    routeId,
    scriptsContext,
} from "@/lib/scripts/http";
import { loadDraftVersion, publishVersion } from "@/lib/scripts/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const ctx = await scriptsContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const forbidden = await requireAdmin(ctx);
    if (forbidden) return forbidden;

    const loaded = await loadTenantScript(supabase, session, await routeId(params));
    if (loaded.response) return loaded.response;
    const { script } = loaded;
    if (script.status === "archived") {
      return jsonError("Archived scripts cannot be published.", 409);
    }
    const migratedBlock = migratedWriteBlocked(script);
    if (migratedBlock) return migratedBlock;

    const draft = await loadDraftVersion(supabase, script, session.tenantId);
    if (!draft) {
      return jsonError("Save a draft before publishing.", 400);
    }

    const tenantLoaded = await loadTenant(supabase, session.tenantId);
    if (tenantLoaded.response) return tenantLoaded.response;

    const published = await publishVersion({
      supabase,
      session,
      script,
      tenant: tenantLoaded.tenant,
      version: draft,
    });
    if (published.response) return published.response;
    return Response.json(published.result);
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

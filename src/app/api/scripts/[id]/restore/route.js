import { composePrompt } from "@/lib/scripts/compose";
import {
  jsonError,
  loadTenant,
  loadTenantScript,
  migratedWriteBlocked,
  requireAdmin,
  routeId,
  scriptsContext,
} from "@/lib/scripts/http";
import {
  insertVersionRow,
  loadVersionByNo,
  maxVersionNo,
  publishVersion,
} from "@/lib/scripts/publish";
import { parseScriptConfig } from "@/lib/scripts/schema";

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
      return jsonError("Archived scripts cannot be restored.", 409);
    }
    const migratedBlock = migratedWriteBlocked(script);
    if (migratedBlock) return migratedBlock;

    const body = await request.json().catch(() => ({}));
    const versionNo = Number(body.version_no);
    if (!Number.isInteger(versionNo) || versionNo < 1) {
      return jsonError("version_no is required.", 400);
    }

    const source = await loadVersionByNo(
      supabase,
      script.id,
      versionNo,
      session.tenantId
    );
    if (!source) return jsonError("Version not found.", 404);

    const parsed = parseScriptConfig(source.config_json);
    if (!parsed.ok) {
      return jsonError("Invalid script config.", 400, { fieldErrors: parsed.fieldErrors });
    }

    const tenantLoaded = await loadTenant(supabase, session.tenantId);
    if (tenantLoaded.response) return tenantLoaded.response;

    const nextNo = (await maxVersionNo(supabase, script.id, session.tenantId)) + 1;
    const prompt = composePrompt({
      config: parsed.data,
      tenant: tenantLoaded.tenant,
      script,
    });
    const version = await insertVersionRow(supabase, {
      scriptId: script.id,
      versionNo: nextNo,
      config: parsed.data,
      prompt,
    });

    const published = await publishVersion({
      supabase,
      session,
      script,
      tenant: tenantLoaded.tenant,
      version,
    });
    if (published.response) return published.response;
    return Response.json(published.result);
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

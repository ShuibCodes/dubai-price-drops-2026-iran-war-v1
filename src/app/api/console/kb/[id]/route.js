import { consoleContext, jsonError } from "@/lib/console/http";
import { routeId } from "@/lib/scripts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const id = await routeId(params);
    const body = await request.json().catch(() => ({}));

    const { data: doc, error } = await supabase
      .from("kb_documents")
      .select("id, tenant_id, owner_agent_id, scope")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc || doc.tenant_id !== session.tenantId) {
      return jsonError("Document not found.", 404);
    }

    if (body.hide === true) {
      const { error: hideError } = await supabase.from("kb_doc_hidden").upsert(
        {
          tenant_id: session.tenantId,
          agent_id: session.agentId,
          doc_id: id,
        },
        { onConflict: "agent_id,doc_id" }
      );
      if (hideError) throw new Error(`Hide failed: ${hideError.message}`);
      return Response.json({ ok: true, hidden: true });
    }

    if (body.hide === false) {
      const { error: showError } = await supabase
        .from("kb_doc_hidden")
        .delete()
        .eq("agent_id", session.agentId)
        .eq("doc_id", id)
        .eq("tenant_id", session.tenantId);
      if (showError) throw new Error(`Unhide failed: ${showError.message}`);
      return Response.json({ ok: true, hidden: false });
    }

    if (body.scope && doc.owner_agent_id === session.agentId) {
      const scope = body.scope === "tenant" ? "tenant" : "private";
      const { error: scopeError } = await supabase
        .from("kb_documents")
        .update({ scope })
        .eq("id", id)
        .eq("tenant_id", session.tenantId)
        .eq("owner_agent_id", session.agentId);
      if (scopeError) throw new Error(`Share failed: ${scopeError.message}`);
      return Response.json({ ok: true, scope });
    }

    return jsonError("Nothing to update.", 400);
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

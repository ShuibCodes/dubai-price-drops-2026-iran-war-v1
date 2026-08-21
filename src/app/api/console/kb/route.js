import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "kb-documents";

async function visibleDocs(supabase, session) {
  const [{ data: docs, error }, { data: hidden, error: hiddenError }] = await Promise.all([
    supabase
      .from("kb_documents")
      .select(
        "id, filename, scope, owner_agent_id, bytes, index_status, parsed_at, created_at"
      )
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("kb_doc_hidden")
      .select("doc_id")
      .eq("agent_id", session.agentId)
      .eq("tenant_id", session.tenantId),
  ]);
  if (error) throw new Error(`KB list failed: ${error.message}`);
  if (hiddenError) throw new Error(`KB hide list failed: ${hiddenError.message}`);
  const hiddenIds = new Set((hidden || []).map((row) => row.doc_id));
  return (docs || []).filter((doc) => {
    if (doc.owner_agent_id === session.agentId) return true;
    if (doc.scope === "tenant") return !hiddenIds.has(doc.id);
    return false;
  }).map((doc) => ({
    ...doc,
    inherited: doc.scope === "tenant" && doc.owner_agent_id !== session.agentId,
    hidden: hiddenIds.has(doc.id),
    mine: doc.owner_agent_id === session.agentId,
  }));
}

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const docs = await visibleDocs(ctx.supabase, ctx.session);
    return Response.json({ documents: docs });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const form = await request.formData();
    const file = form.get("file");
    const scope = form.get("scope") === "tenant" ? "tenant" : "private";
    if (!file || typeof file.arrayBuffer !== "function") {
      return jsonError("file is required.", 400);
    }

    const filename = String(file.name || "untitled").slice(0, 180);
    const bytes = Number(file.size) || 0;
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = crypto.randomUUID();
    const storagePath = `${session.tenantId}/${session.agentId}/${id}-${filename}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) {
      return jsonError(`Upload failed: ${uploadError.message}`, 502);
    }

    const textLike = /\.(txt|md|csv|json)$/i.test(filename);
    const { data, error } = await supabase
      .from("kb_documents")
      .insert({
        tenant_id: session.tenantId,
        owner_agent_id: session.agentId,
        scope,
        filename,
        storage_path: storagePath,
        bytes,
        parsed_at: textLike ? new Date().toISOString() : null,
        index_status: textLike ? "indexed" : "queued",
      })
      .select(
        "id, filename, scope, owner_agent_id, bytes, index_status, parsed_at, created_at"
      )
      .single();
    if (error) throw new Error(`KB insert failed: ${error.message}`);

    return Response.json({ document: { ...data, inherited: false, hidden: false, mine: true } }, { status: 201 });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

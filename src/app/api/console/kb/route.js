import { consoleContext, jsonError } from "@/lib/console/http";
import {
  KB_BUCKET,
  KB_ERRORS,
  buildKnowledgeStoragePath,
  createKnowledgeRowAfterUpload,
  inspectKnowledgeFile,
  knowledgeInsert,
  publicKnowledgeDocument,
} from "@/lib/kb/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = KB_BUCKET;

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

    const inspected = inspectKnowledgeFile({ name: file.name, size: file.size });
    if (!inspected.ok) return jsonError(inspected.error, inspected.status);
    if (inspected.direct) return jsonError(KB_ERRORS.tooBigForForm, 413);

    const buffer = Buffer.from(await file.arrayBuffer());
    const id = crypto.randomUUID();
    const storagePath = buildKnowledgeStoragePath({
      tenantId: session.tenantId,
      agentId: session.agentId,
      filename: inspected.filename,
      id,
    });

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) {
      console.error("[kb] storage upload failed", uploadError.message);
    }

    const result = await createKnowledgeRowAfterUpload({
      uploaded: !uploadError,
      insert: async () => {
        const { data, error } = await supabase
          .from("kb_documents")
          .insert(
            knowledgeInsert(session, {
              scope,
              filename: inspected.filename,
              storagePath,
              bytes: inspected.bytes,
            })
          )
          .select(
            "id, filename, scope, owner_agent_id, bytes, index_status, parsed_at, created_at"
          )
          .single();
        if (error) throw new Error(error.message);
        return publicKnowledgeDocument(data);
      },
      removeOrphan: async () => {
        await supabase.storage.from(BUCKET).remove([storagePath]);
      },
    });
    if (!result.ok) return jsonError(result.error, result.status);

    return Response.json({ document: result.document }, { status: 201 });
  } catch (error) {
    console.error("[kb] upload failed", error?.message || error);
    return jsonError(KB_ERRORS.storage, 500);
  }
}

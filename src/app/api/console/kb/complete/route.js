import { consoleContext, jsonError } from "@/lib/console/http";
import {
  KB_BUCKET,
  KB_ERRORS,
  KB_MAX_BYTES,
  assertAgentStoragePath,
  createKnowledgeRowAfterUpload,
  inspectKnowledgeFile,
  knowledgeInsert,
  listedObject,
  publicKnowledgeDocument,
  storedObjectBytes,
} from "@/lib/kb/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOC_COLS =
  "id, filename, scope, owner_agent_id, bytes, index_status, parsed_at, created_at";

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const body = await request.json().catch(() => ({}));
    const owned = assertAgentStoragePath(
      body.storagePath,
      session.tenantId,
      session.agentId
    );
    if (!owned.ok) return jsonError(owned.error, owned.status);

    const inspected = inspectKnowledgeFile({
      name: body.filename,
      size: body.bytes,
    });
    if (!inspected.ok) return jsonError(inspected.error, inspected.status);

    const { data: existing, error: existingError } = await supabase
      .from("kb_documents")
      .select(DOC_COLS)
      .eq("tenant_id", session.tenantId)
      .eq("owner_agent_id", session.agentId)
      .eq("storage_path", owned.path)
      .maybeSingle();
    if (existingError) {
      console.error("[kb] existing document lookup failed", existingError.message);
      return jsonError(KB_ERRORS.record, 502);
    }
    if (existing) {
      return Response.json({ document: publicKnowledgeDocument(existing) });
    }

    const folder = `${session.tenantId}/${session.agentId}`;
    const { data: listed, error: listError } = await supabase.storage
      .from(KB_BUCKET)
      .list(folder, { search: owned.objectName, limit: 100 });
    if (listError) {
      console.error("[kb] storage list failed", listError.message);
      return jsonError(KB_ERRORS.missingObject, 502);
    }
    const object = listedObject(listed, owned.objectName);
    if (!object) return jsonError(KB_ERRORS.missingObject, 400);

    const bytes = storedObjectBytes(object, inspected.bytes);
    if (bytes > KB_MAX_BYTES) {
      await supabase.storage.from(KB_BUCKET).remove([owned.path]);
      return jsonError(KB_ERRORS.tooBig, 413);
    }

    const scope = body.scope === "tenant" ? "tenant" : "private";
    const result = await createKnowledgeRowAfterUpload({
      uploaded: true,
      insert: async () => {
        const { data, error } = await supabase
          .from("kb_documents")
          .insert(
            knowledgeInsert(session, {
              scope,
              filename: inspected.filename,
              storagePath: owned.path,
              bytes,
            })
          )
          .select(DOC_COLS)
          .single();
        if (error) throw new Error(error.message);
        return publicKnowledgeDocument(data);
      },
      removeOrphan: async () => {
        await supabase.storage.from(KB_BUCKET).remove([owned.path]);
      },
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json({ document: result.document }, { status: 201 });
  } catch (error) {
    console.error("[kb] complete failed", error?.message || error);
    return jsonError(KB_ERRORS.record, 500);
  }
}

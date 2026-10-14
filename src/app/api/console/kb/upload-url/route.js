import { consoleContext, jsonError } from "@/lib/console/http";
import {
  KB_BUCKET,
  KB_ERRORS,
  assertAgentStoragePath,
  buildKnowledgeStoragePath,
  inspectKnowledgeFile,
} from "@/lib/kb/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const body = await request.json().catch(() => ({}));
    const inspected = inspectKnowledgeFile({
      name: body.filename,
      size: body.bytes,
    });
    if (!inspected.ok) return jsonError(inspected.error, inspected.status);
    if (!inspected.direct) {
      return jsonError("This file can be uploaded with the standard form.", 400);
    }

    const storagePath = buildKnowledgeStoragePath({
      tenantId: session.tenantId,
      agentId: session.agentId,
      filename: inspected.filename,
      id: crypto.randomUUID(),
    });
    const { data, error } = await supabase.storage
      .from(KB_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    const issued = assertAgentStoragePath(
      data?.path || storagePath,
      session.tenantId,
      session.agentId
    );
    if (error || !data?.signedUrl || !data?.token || !issued.ok) {
      console.error("[kb] signed upload url failed", error?.message || "missing url");
      return jsonError(KB_ERRORS.start, 502);
    }

    return Response.json({
      signedUrl: data.signedUrl,
      token: data.token,
      storagePath: issued.path,
    });
  } catch (error) {
    console.error("[kb] upload-url failed", error?.message || error);
    return jsonError(KB_ERRORS.start, 500);
  }
}

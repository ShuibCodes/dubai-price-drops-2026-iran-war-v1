export const KB_BUCKET = "kb-documents";

/** Supabase bucket cap from migration 022. Do not raise this here. */
export const KB_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Stay under the Vercel request-body limit (~4.5 MB) including multipart
 * overhead. Larger files upload with a signed URL and never enter this API.
 */
export const KB_API_BODY_MAX_BYTES = 4 * 1024 * 1024;

export const KB_ACCEPT = ".pdf,.txt,.md,.csv,.png,.jpg,.jpeg";

const ALLOWED_EXTENSIONS = new Set(["pdf", "txt", "md", "csv", "png", "jpg", "jpeg"]);

export const KB_ERRORS = {
  unsupported: "Use a PDF, TXT, MD, CSV, PNG, or JPG file.",
  empty: "That file is empty.",
  tooBig: "That file is larger than 20 MB. Choose a smaller file.",
  tooBigForForm:
    "This file is too large to send through the form. Upload it again.",
  storage: "The file could not be stored. Try again.",
  record: "The file could not be saved to your knowledge base. Try again.",
  missingObject: "The uploaded file was not found. Try again.",
  start: "Could not start the upload. Try again.",
  invalidPath: "That upload path is not allowed.",
  deleteMissing: "Document not found.",
  deleteForbidden: "You can only delete documents you uploaded.",
  deleteStorage:
    "Could not delete the stored file. The document is still in your knowledge base.",
  deleteRow: "The file was removed but the document record could not be deleted.",
};

export function displayFilename(name) {
  const base = String(name || "untitled").split(/[/\\]/).pop() || "untitled";
  return base.slice(0, 180);
}

export function fileExtension(filename) {
  const base = displayFilename(filename).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1);
}

export function inspectKnowledgeFile({ name, size } = {}) {
  const filename = displayFilename(name);
  const extension = fileExtension(filename);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { ok: false, status: 400, error: KB_ERRORS.unsupported };
  }
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, status: 400, error: KB_ERRORS.empty };
  }
  if (bytes > KB_MAX_BYTES) {
    return { ok: false, status: 413, error: KB_ERRORS.tooBig };
  }
  return {
    ok: true,
    filename,
    bytes,
    extension,
    direct: bytes > KB_API_BODY_MAX_BYTES,
  };
}

export function storageObjectName(filename, id) {
  const cleaned = displayFilename(filename)
    .normalize("NFKC")
    .replace(/[^\w.\- ()]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return `${id}-${cleaned || "file"}`;
}

export function buildKnowledgeStoragePath({ tenantId, agentId, filename, id }) {
  const objectName = storageObjectName(filename, id);
  return `${tenantId}/${agentId}/${objectName}`;
}

export function assertAgentStoragePath(storagePath, tenantId, agentId) {
  const path = String(storagePath || "").replace(/\\/g, "/");
  const prefix = `${tenantId}/${agentId}/`;
  if (
    !tenantId ||
    !agentId ||
    path.includes("..") ||
    path.startsWith("/") ||
    path.includes("//") ||
    !path.startsWith(prefix)
  ) {
    return { ok: false, status: 400, error: KB_ERRORS.invalidPath };
  }
  const rest = path.slice(prefix.length);
  if (!rest || rest.includes("/")) {
    return { ok: false, status: 400, error: KB_ERRORS.invalidPath };
  }
  return { ok: true, path, objectName: rest };
}

export function knowledgeInsert(session, { scope, filename, storagePath, bytes }) {
  const textLike = /\.(txt|md|csv|json)$/i.test(filename);
  return {
    tenant_id: session.tenantId,
    owner_agent_id: session.agentId,
    scope: scope === "tenant" ? "tenant" : "private",
    filename,
    storage_path: storagePath,
    bytes,
    parsed_at: textLike ? new Date().toISOString() : null,
    index_status: textLike ? "indexed" : "queued",
  };
}

export function publicKnowledgeDocument(row) {
  return {
    ...row,
    inherited: false,
    hidden: false,
    mine: true,
  };
}

export function authorizeKnowledgeDelete(doc, session) {
  if (!doc || doc.tenant_id !== session?.tenantId) {
    return { ok: false, status: 404, error: KB_ERRORS.deleteMissing };
  }
  if (!doc.owner_agent_id || doc.owner_agent_id !== session.agentId) {
    return { ok: false, status: 403, error: KB_ERRORS.deleteForbidden };
  }
  const owned = assertAgentStoragePath(
    doc.storage_path,
    session.tenantId,
    session.agentId
  );
  if (!owned.ok) {
    return { ok: false, status: 409, error: KB_ERRORS.deleteStorage };
  }
  return { ok: true, path: owned.path };
}

export async function createKnowledgeRowAfterUpload({
  uploaded,
  insert,
  removeOrphan,
}) {
  if (!uploaded) {
    return { ok: false, status: 502, error: KB_ERRORS.storage };
  }
  try {
    const document = await insert();
    return { ok: true, document };
  } catch (error) {
    console.error("[kb] document insert failed", error?.message || error);
    try {
      await removeOrphan?.();
    } catch (cleanupError) {
      console.error("[kb] orphan cleanup failed", cleanupError?.message || cleanupError);
    }
    return { ok: false, status: 502, error: KB_ERRORS.record };
  }
}

export async function deleteKnowledgeDocument({ doc, session, removeObject, deleteRow }) {
  const auth = authorizeKnowledgeDelete(doc, session);
  if (!auth.ok) return auth;
  const removed = await removeObject(auth.path);
  if (!removed?.ok) {
    return { ok: false, status: 502, error: KB_ERRORS.deleteStorage };
  }
  try {
    await deleteRow(doc.id);
  } catch (error) {
    console.error("[kb] document row delete failed", error?.message || error);
    return { ok: false, status: 502, error: KB_ERRORS.deleteRow };
  }
  return { ok: true };
}

export function listedObject(items, objectName) {
  return (items || []).find((item) => item?.name === objectName) || null;
}

export function storedObjectBytes(item, fallbackBytes) {
  const size = Number(item?.metadata?.size);
  if (Number.isFinite(size) && size > 0) return size;
  return fallbackBytes;
}

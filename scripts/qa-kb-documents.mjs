/**
 * Knowledge upload limits, signed-path ownership, and document deletion.
 * No live Supabase or storage calls.
 *
 * node scripts/qa-kb-documents.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const {
  KB_API_BODY_MAX_BYTES,
  KB_ERRORS,
  KB_MAX_BYTES,
  assertAgentStoragePath,
  authorizeKnowledgeDelete,
  buildKnowledgeStoragePath,
  createKnowledgeRowAfterUpload,
  deleteKnowledgeDocument,
  inspectKnowledgeFile,
  knowledgeInsert,
  listedObject,
  storageObjectName,
  storedObjectBytes,
} = await import("../src/lib/kb/documents.js");

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const AGENT = "agent-a";
const OTHER_AGENT = "agent-b";
const session = { tenantId: TENANT, agentId: AGENT };

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name.padEnd(72)} ${detail}`);
}

console.log("\nUPLOAD LIMITS");
{
  const small = inspectKnowledgeFile({ name: "price-list.pdf", size: 1200 });
  check("small pdf is accepted on the form path", small.ok && small.direct === false);
  check(
    "small pdf stays queued and is not parsed",
    knowledgeInsert(session, {
      scope: "private",
      filename: small.filename,
      storagePath: "tenant-a/agent-a/id-price-list.pdf",
      bytes: small.bytes,
    }).index_status === "queued"
  );

  const text = inspectKnowledgeFile({ name: "notes.txt", size: 40 });
  check(
    "text files stay indexed",
    knowledgeInsert(session, {
      scope: "tenant",
      filename: text.filename,
      storagePath: "tenant-a/agent-a/id-notes.txt",
      bytes: text.bytes,
    }).index_status === "indexed"
  );

  const over = inspectKnowledgeFile({ name: "profile.pdf", size: KB_MAX_BYTES + 1 });
  check("oversized file is rejected", !over.ok && over.status === 413, over.error);
  check("oversized error names the 20 MB limit", over.error === KB_ERRORS.tooBig);

  const docx = inspectKnowledgeFile({ name: "profile.docx", size: 100 });
  check("docx is rejected", !docx.ok && docx.error === KB_ERRORS.unsupported);

  const direct = inspectKnowledgeFile({
    name: "company-profile.pdf",
    size: KB_API_BODY_MAX_BYTES + 1,
  });
  check("file above 4 MB uses direct upload", direct.ok && direct.direct === true);
  check("file at 4 MB still uses the form", inspectKnowledgeFile({
    name: "brochure.pdf",
    size: KB_API_BODY_MAX_BYTES,
  }).direct === false);
}

console.log("\nSIGNED PATH");
{
  const path = buildKnowledgeStoragePath({
    tenantId: TENANT,
    agentId: AGENT,
    filename: "Company Profile.pdf",
    id: "11111111-1111-1111-1111-111111111111",
  });
  const owned = assertAgentStoragePath(path, TENANT, AGENT);
  check("built path stays in the agent prefix", owned.ok && path.startsWith(`${TENANT}/${AGENT}/`));
  check(
    "object name cannot contain a slash",
    !storageObjectName("../../other/secret.pdf", "id").includes("/")
  );
  check(
    "another tenant prefix is rejected",
    !assertAgentStoragePath(`${OTHER_TENANT}/${AGENT}/file.pdf`, TENANT, AGENT).ok
  );
  check(
    "another agent prefix is rejected",
    !assertAgentStoragePath(`${TENANT}/${OTHER_AGENT}/file.pdf`, TENANT, AGENT).ok
  );
  check(
    "parent traversal is rejected",
    !assertAgentStoragePath(`${TENANT}/${AGENT}/../${OTHER_AGENT}/file.pdf`, TENANT, AGENT).ok
  );
  check(
    "nested path is rejected",
    !assertAgentStoragePath(`${TENANT}/${AGENT}/nested/file.pdf`, TENANT, AGENT).ok
  );
}

console.log("\nROW AFTER STORAGE");
{
  let inserted = false;
  let removed = false;
  const failed = await createKnowledgeRowAfterUpload({
    uploaded: false,
    insert: async () => {
      inserted = true;
      return { id: "should-not" };
    },
    removeOrphan: async () => {
      removed = true;
    },
  });
  check("storage failure does not insert a row", failed.ok === false && inserted === false);
  check("storage failure error is generic", failed.error === KB_ERRORS.storage);

  inserted = false;
  const saved = await createKnowledgeRowAfterUpload({
    uploaded: true,
    insert: async () => {
      inserted = true;
      return { id: "doc-1", filename: "price-list.pdf" };
    },
  });
  check("successful storage inserts one row", saved.ok && inserted && saved.document.id === "doc-1");

  removed = false;
  const insertFailed = await createKnowledgeRowAfterUpload({
    uploaded: true,
    insert: async () => {
      throw new Error("duplicate key value violates kb_documents_pkey");
    },
    removeOrphan: async () => {
      removed = true;
    },
  });
  check("insert failure does not return a row", insertFailed.ok === false && !insertFailed.document);
  check("insert failure removes the stored object", removed === true);
  check("insert failure hides the database error", insertFailed.error === KB_ERRORS.record);

  const object = listedObject(
    [{ name: "other.pdf" }, { name: "id-profile.pdf", metadata: { size: 50 } }],
    "id-profile.pdf"
  );
  check("complete matches only the issued object name", object?.name === "id-profile.pdf");
  check(
    "stored size above 20 MB is detectable",
    storedObjectBytes({ metadata: { size: KB_MAX_BYTES + 5 } }, 10) > KB_MAX_BYTES
  );
}

console.log("\nDELETE");
{
  const own = {
    id: "doc-own",
    tenant_id: TENANT,
    owner_agent_id: AGENT,
    storage_path: `${TENANT}/${AGENT}/id-price-list.pdf`,
  };
  const teammate = {
    id: "doc-team",
    tenant_id: TENANT,
    owner_agent_id: OTHER_AGENT,
    storage_path: `${TENANT}/${OTHER_AGENT}/id-plan.pdf`,
  };
  const foreign = {
    id: "doc-foreign",
    tenant_id: OTHER_TENANT,
    owner_agent_id: AGENT,
    storage_path: `${OTHER_TENANT}/${AGENT}/id-plan.pdf`,
  };

  check("owner is allowed", authorizeKnowledgeDelete(own, session).ok === true);
  const denied = authorizeKnowledgeDelete(teammate, session);
  check("same-tenant non-owner is forbidden", denied.status === 403, denied.error);
  const missing = authorizeKnowledgeDelete(foreign, session);
  check("cross-tenant delete is not found", missing.status === 404);

  let removedPath = null;
  let deletedId = null;
  const success = await deleteKnowledgeDocument({
    doc: own,
    session,
    removeObject: async (path) => {
      removedPath = path;
      return { ok: true };
    },
    deleteRow: async (id) => {
      deletedId = id;
    },
  });
  check(
    "owner delete removes storage then the row",
    success.ok && removedPath === own.storage_path && deletedId === own.id
  );

  deletedId = null;
  const storageFailed = await deleteKnowledgeDocument({
    doc: own,
    session,
    removeObject: async () => ({ ok: false }),
    deleteRow: async (id) => {
      deletedId = id;
    },
  });
  check(
    "storage failure keeps the database row",
    storageFailed.ok === false && deletedId === null && storageFailed.error === KB_ERRORS.deleteStorage
  );

  const blocked = await deleteKnowledgeDocument({
    doc: teammate,
    session,
    removeObject: async () => ({ ok: true }),
    deleteRow: async () => {
      throw new Error("should not delete");
    },
  });
  check("non-owner delete does not remove storage", blocked.status === 403);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");

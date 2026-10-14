import { consoleJson } from "@/lib/console/client";
import { inspectKnowledgeFile } from "@/lib/kb/documents";

async function putSignedFile(signedUrl, token, file) {
  const url = new URL(signedUrl);
  if (token) url.searchParams.set("token", token);
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  const response = await fetch(url.toString(), {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body,
  });
  if (!response.ok) {
    throw new Error("The file could not be stored. Try again.");
  }
}

export async function uploadKnowledgeFile(base, file, scope = "private") {
  const inspected = inspectKnowledgeFile({ name: file?.name, size: file?.size });
  if (!inspected.ok) {
    throw new Error(inspected.error);
  }

  if (!inspected.direct) {
    const form = new FormData();
    form.set("file", file);
    form.set("scope", scope);
    return consoleJson(base, "/api/console/kb", {
      method: "POST",
      body: form,
      fallback: "The file could not be stored. Try again.",
    });
  }

  const ticket = await consoleJson(base, "/api/console/kb/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    fallback: "Could not start the upload. Try again.",
    body: JSON.stringify({
      filename: inspected.filename,
      bytes: inspected.bytes,
      scope,
    }),
  });
  await putSignedFile(ticket.signedUrl, ticket.token, file);
  return consoleJson(base, "/api/console/kb/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    fallback: "The file could not be saved to your knowledge base. Try again.",
    body: JSON.stringify({
      storagePath: ticket.storagePath,
      filename: inspected.filename,
      bytes: inspected.bytes,
      scope,
    }),
  });
}

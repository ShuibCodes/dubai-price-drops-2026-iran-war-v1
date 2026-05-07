"use client";

import { useState } from "react";

/**
 * @typedef {{ id?: string, name?: string }} AgentRow
 */

/**
 * @param {{ agents?: AgentRow[] }} props
 */
export default function WhatsAppUploader({ agents = [] }) {
  const [status, setStatus] = useState("idle");

  const [selectedAgentId, setSelectedAgentId] = useState("");

  const [selectedFiles, setSelectedFiles] = useState([]);

  const [errorMessage, setErrorMessage] = useState("");

  /** Result returned by POST /api/onboard/whatsapp-upload on success. */
  const [successPayload, setSuccessPayload] = useState(null);

  function resetToIdle() {
    setStatus("idle");
    setErrorMessage("");
    setSuccessPayload(null);
  }

  /** @param {React.ChangeEvent<HTMLInputElement>} e */
  function handleFilePick(e) {
    const picked = e.target.files;
    resetToIdle();
    setSelectedFiles(picked ? Array.from(picked) : []);
    e.target.value = "";
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) return;

    setStatus("uploading");
    setErrorMessage("");
    setSuccessPayload(null);

    try {
      const body = new FormData();
      for (const file of selectedFiles) {
        body.append("files", file);
      }
      if (selectedAgentId.trim()) {
        body.append("agentId", selectedAgentId.trim());
      }

      const response = await fetch("/api/onboard/whatsapp-upload", {
        method: "POST",
        body,
      });

      const data = await response.json();

      if (!response.ok) {
        const msg =
          (data &&
            typeof data.error === "string" &&
            data.error.trim()) ||
          `Upload failed with status ${response.status}.`;
        setErrorMessage(msg);
        setStatus("error");
        return;
      }

      setSuccessPayload({
        filesUploaded: data.filesUploaded,
        docsAdded: data.docsAdded,
        files: Array.isArray(data.files) ? data.files : [],
      });
      setStatus("success");
      setSelectedFiles([]);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Try again.";
      setErrorMessage(msg);
      setStatus("error");
    }
  }

  const uploading = status === "uploading";

  return (
    <section className="rounded-xl border border-[var(--border)] border-dashed bg-[var(--surface)]/80 p-6">
      <h3 className="text-base font-medium text-[var(--foreground)]">
        WhatsApp Export Uploader
      </h3>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Choose an agent label (optional), then select one or more WhatsApp chat
        export .txt files. They upload to your knowledge base.
      </p>

      <div className="mt-4 grid gap-3">
        <label className="block text-xs font-medium text-[var(--muted)]">
          Agent
          <select
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--foreground)]"
            value={selectedAgentId}
            disabled={uploading}
            onChange={(e) => {
              resetToIdle();
              setSelectedAgentId(e.target.value);
            }}
          >
            <option value="">No agent selected</option>
            {agents.map((agent, index) => {
              const id =
                typeof agent?.id === "string" ? agent.id : String(agent?.id ?? "");
              const label =
                typeof agent?.name === "string" && agent.name.trim()
                  ? `${agent.name} (${id})`
                  : id || "Unnamed";
              const key = id || `agent-row-${index}`;
              return (
                <option key={key} value={id}>
                  {label}
                </option>
              );
            })}
          </select>
        </label>

        <label className="block text-xs font-medium text-[var(--muted)]">
          Export files (.txt)
          <input
            type="file"
            multiple
            accept=".txt,text/plain"
            disabled={uploading}
            className="mt-1 block w-full text-sm text-[var(--foreground)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-elevated)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--foreground)]"
            onChange={handleFilePick}
          />
        </label>

        {selectedFiles.length > 0 && status !== "success" ? (
          <p className="text-xs text-[var(--muted)]">
            {selectedFiles.length} file
            {selectedFiles.length !== 1 ? "s" : ""} selected
          </p>
        ) : null}
      </div>

      <button
        type="button"
        disabled={uploading || selectedFiles.length === 0}
        onClick={() => handleUpload()}
        className={`mt-4 w-full rounded-lg border px-3 py-2 text-sm font-medium ${
          uploading || selectedFiles.length === 0
            ? "cursor-not-allowed border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
            : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] hover:opacity-90"
        }`}
      >
        {uploading ? "Uploading…" : "Upload to knowledge base"}
      </button>

      {status === "success" && successPayload ? (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)]">
          <p className="font-medium text-[var(--foreground)]">Upload complete</p>
          <ul className="mt-2 list-inside list-disc text-[var(--muted)]">
            <li>filesUploaded: {successPayload.filesUploaded}</li>
            <li>docsAdded: {successPayload.docsAdded}</li>
          </ul>
          <ul className="mt-4 space-y-3">
            {successPayload.files.map((f, i) => (
              <li
                key={`${f.savedAs}-${String(i)}`}
                className="rounded-md border border-[var(--border)] p-3"
              >
                <p className="font-medium text-[var(--foreground)]">
                  {f.originalName}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  saved as:{" "}
                  <span className="text-[var(--foreground)]">{f.savedAs}</span>
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  messageCount:{" "}
                  <span className="text-[var(--foreground)]">
                    {f.messageCount}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  participants:{" "}
                  <span className="text-[var(--foreground)]">
                    {Array.isArray(f.participants) &&
                    f.participants.length > 0
                      ? f.participants.join(", ")
                      : "—"}
                  </span>
                </p>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-4 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--foreground)]"
            onClick={resetToIdle}
          >
            Upload another batch
          </button>
        </div>
      ) : null}

      {status === "error" ? (
        <div
          className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"
          role="alert"
        >
          {errorMessage || "Upload failed."}
        </div>
      ) : null}
    </section>
  );
}

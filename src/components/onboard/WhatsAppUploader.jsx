"use client";

import { useRef, useState } from "react";

/**
 * @typedef {{ id?: string, name?: string }} AgentRow
 */

/**
 * @param {{ agents?: AgentRow[] }} props
 */
export default function WhatsAppUploader({ agents = [] }) {
  const fileInputRef = useRef(null);
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

  /** @param {File[]} files */
  function setTxtSelection(files) {
    if (files.length === 0) {
      setSelectedFiles([]);
      return;
    }
    const hasNonTxt = files.some(
      (f) => !f.name.toLowerCase().endsWith(".txt"),
    );
    if (hasNonTxt) {
      setErrorMessage(
        "Only WhatsApp export .txt files are accepted. Your selection includes non-.txt files — fix the selection and try again.",
      );
      setStatus("error");
      setSelectedFiles([]);
      return;
    }
    setSelectedFiles(files);
  }

  /** @param {React.ChangeEvent<HTMLInputElement>} e */
  function handleFilePick(e) {
    const picked = e.target.files;
    resetToIdle();
    setTxtSelection(picked ? Array.from(picked) : []);
    e.target.value = "";
  }

  /** @param {React.DragEvent} e */
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /** @param {React.DragEvent} e */
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (status === "uploading") return;
    resetToIdle();
    const files = Array.from(e.dataTransfer.files || []);
    setTxtSelection(files);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) return;
    if (!selectedAgentId.trim()) {
      setErrorMessage("Select an agent before uploading.");
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setErrorMessage("");
    setSuccessPayload(null);

    try {
      const body = new FormData();
      for (const file of selectedFiles) {
        body.append("files", file);
      }
      body.append("agentId", selectedAgentId.trim());

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
        leads: Array.isArray(data.leads) ? data.leads : null,
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

  const leadsSummary =
    successPayload &&
    Array.isArray(successPayload.leads) &&
    successPayload.leads.length > 0
      ? successPayload.leads.join(", ")
      : "—";

  return (
    <section className="rounded-xl border border-[var(--border)] border-dashed bg-[var(--surface)]/80 p-6">
      <h3 className="text-base font-medium text-[var(--foreground)]">
        WhatsApp Export Uploader
      </h3>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Choose an agent, then select one or more WhatsApp chat export .txt files.
        They upload to your knowledge base.
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
                  ? agent.name.trim()
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

        <div className="block text-xs font-medium text-[var(--muted)]">
          <span className="block">Export files (.txt)</span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,text/plain"
            disabled={uploading}
            className="sr-only"
            onChange={handleFilePick}
          />
          <div
            role="button"
            tabIndex={uploading ? -1 : 0}
            aria-disabled={uploading}
            onClick={() => {
              if (!uploading) openFilePicker();
            }}
            onKeyDown={(e) => {
              if (uploading) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openFilePicker();
              }
            }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={`mt-1 flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-6 text-center text-sm text-[var(--foreground)] transition hover:border-[var(--muted)] ${
              uploading
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer"
            }`}
          >
            <span className="font-medium text-[var(--foreground)]">
              Drop .txt files here or click to choose
            </span>
            <span className="mt-1 text-xs text-[var(--muted)]">
              Tip: hold Ctrl or Shift to select multiple .txt files.
            </span>
          </div>
        </div>

        {selectedFiles.length > 0 && status !== "success" ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
            <p className="font-medium text-[var(--foreground)]">Selected files</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {selectedFiles.slice(0, 5).map((f, i) => (
                <li
                  key={`${f.name}-${String(f.size)}-${String(i)}`}
                  className="truncate text-[var(--foreground)]"
                  title={f.name}
                >
                  {f.name}
                </li>
              ))}
            </ul>
            {selectedFiles.length > 5 ? (
              <p className="mt-1 text-[var(--muted)]">
                +{selectedFiles.length - 5} more
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        disabled={uploading || selectedFiles.length === 0 || !selectedAgentId.trim()}
        onClick={() => handleUpload()}
        className={`mt-4 w-full rounded-lg border px-3 py-2 text-sm font-medium ${
          uploading || selectedFiles.length === 0 || !selectedAgentId.trim()
            ? "cursor-not-allowed border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
            : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] hover:opacity-90"
        }`}
      >
        {uploading ? "Uploading and parsing…" : "Upload to knowledge base"}
      </button>

      {uploading ? (
        <p className="mt-2 text-center text-xs text-[var(--muted)]" aria-live="polite">
          Uploading and parsing…
        </p>
      ) : null}

      {status === "success" && successPayload ? (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)]">
          <p className="font-medium text-[var(--foreground)]">Upload complete</p>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            <li>
              <span className="text-[var(--foreground)]">Documents added:</span>{" "}
              {successPayload.docsAdded}
            </li>
            <li>
              <span className="text-[var(--foreground)]">Leads detected:</span>{" "}
              <span className="text-[var(--foreground)]">{leadsSummary}</span>
            </li>
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
                  <span className="text-[var(--foreground)]">Saved as:</span>{" "}
                  {f.savedAs}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  <span className="text-[var(--foreground)]">Message count:</span>{" "}
                  {f.messageCount}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  <span className="text-[var(--foreground)]">Participants:</span>{" "}
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

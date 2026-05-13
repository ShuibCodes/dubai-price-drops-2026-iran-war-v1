"use client";

import { useRef, useState } from "react";

/**
 * @typedef {{ id?: string, name?: string }} AgentRow
 */

/** @param {string} s */
function normNameKey(s) {
  return s.trim().toLowerCase();
}

/** @param {AgentRow} agent */
function agentDisplayLabel(agent) {
  const id =
    typeof agent?.id === "string" ? agent.id : String(agent?.id ?? "");
  if (typeof agent?.name === "string" && agent.name.trim()) {
    return agent.name.trim();
  }
  return id || "Unnamed";
}

/**
 * Known agent labels from roster + selected agent (same labels as the Agent dropdown).
 * @param {AgentRow[]} agentList
 * @param {string} selectedAgentIdRaw
 */
function buildExcludedAgentNameKeys(agentList, selectedAgentIdRaw) {
  const keys = new Set();
  for (const agent of agentList) {
    const k = normNameKey(agentDisplayLabel(agent));
    if (k) keys.add(k);
  }
  const sel = selectedAgentIdRaw.trim();
  if (sel) {
    const selected = agentList.find((a) => {
      const id =
        typeof a?.id === "string" ? a.id : String(a?.id ?? "");
      return id.trim() === sel;
    });
    if (selected) {
      const k = normNameKey(agentDisplayLabel(selected));
      if (k) keys.add(k);
    }
  }
  return keys;
}

/**
 * @param {unknown} participants
 * @param {Set<string>} excludedNormalized
 */
function participantsMinusAgents(participants, excludedNormalized) {
  if (!Array.isArray(participants)) return [];
  const out = [];
  for (const p of participants) {
    if (typeof p !== "string") continue;
    const t = p.trim();
    if (!t) continue;
    if (excludedNormalized.has(normNameKey(t))) continue;
    out.push(t);
  }
  return out;
}

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

  /** @param {string} raw */
  function friendlyUploadApiError(raw) {
    const s = raw.trim();
    if (s.includes("Unknown agentId")) {
      return "This agent is not saved yet. Save the agent roster first, then try uploading again.";
    }
    return s;
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
        const raw =
          (data &&
            typeof data.error === "string" &&
            data.error.trim()) ||
          `Upload failed with status ${response.status}.`;
        setErrorMessage(friendlyUploadApiError(raw));
        setStatus("error");
        return;
      }

      setSuccessPayload({
        filesUploaded: data.filesUploaded,
        docsAdded: data.docsAdded,
        leads: Array.isArray(data.leads) ? data.leads : [],
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

  const excludedAgentNameKeys =
    status === "success" && successPayload
      ? buildExcludedAgentNameKeys(agents, selectedAgentId)
      : null;

  const detectedLeadPerFile =
    excludedAgentNameKeys && successPayload
      ? successPayload.files.map((f, i) => {
          const fromApi = Array.isArray(successPayload.leads)
            ? successPayload.leads[i]
            : undefined;
          if (typeof fromApi === "string" && fromApi.trim()) {
            return fromApi.trim();
          }
          const remaining = participantsMinusAgents(
            f.participants,
            excludedAgentNameKeys,
          );
          return remaining.length > 0 ? remaining[0] : null;
        })
      : null;

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
          <p className="mt-1.5 text-xs font-normal text-[var(--muted)]">
            Save the agent roster before uploading files for a new or edited agent.
          </p>
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
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            Tip: hold Ctrl or Shift to select multiple .txt files.
          </p>
        </div>

        {selectedFiles.length > 0 && status !== "success" ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
            <p className="font-medium text-[var(--foreground)]">
              {selectedFiles.length === 1
                ? "1 file selected"
                : `${selectedFiles.length} files selected`}
            </p>
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
              <span className="text-[var(--foreground)]">Files uploaded:</span>{" "}
              {successPayload.filesUploaded}
            </li>
            <li>
              <span className="text-[var(--foreground)]">Documents added:</span>{" "}
              {successPayload.docsAdded}
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
                <p className="mt-1 text-xs text-[var(--muted)]">
                  <span className="text-[var(--foreground)]">
                    Detected lead / conversation:
                  </span>{" "}
                  <span className="text-[var(--foreground)]">
                    {detectedLeadPerFile && detectedLeadPerFile[i]
                      ? detectedLeadPerFile[i]
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

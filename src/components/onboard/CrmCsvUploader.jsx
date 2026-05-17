"use client";

import { useRef, useState } from "react";

const AGENT_ID = "sterling-boulevard";

const TRUST_LINE =
  "Your data is used only to answer your questions. It is never shared, sold, or visible to anyone else.";

/**
 * @param {{ onBack?: () => void, onAddMoreData?: () => void }} props
 */
export default function CrmCsvUploader({ onAddMoreData }) {
  const fileInputRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [successPayload, setSuccessPayload] = useState(null);

  function resetToIdle() {
    setStatus("idle");
    setErrorMessage("");
    setSuccessPayload(null);
  }

  /** @param {File[]} files */
  function setCsvSelection(files) {
    if (files.length === 0) {
      setSelectedFiles([]);
      return;
    }
    const hasNonCsv = files.some(
      (f) => !f.name.toLowerCase().endsWith(".csv"),
    );
    if (hasNonCsv) {
      setErrorMessage(
        "Only .csv files are accepted. Your selection includes non-.csv files — fix the selection and try again.",
      );
      setStatus("error");
      setSelectedFiles([]);
      return;
    }
    setSelectedFiles(files);
  }

  function handleFilePick(e) {
    const picked = e.target.files;
    resetToIdle();
    setCsvSelection(picked ? Array.from(picked) : []);
    e.target.value = "";
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (status === "uploading") return;
    resetToIdle();
    const files = Array.from(e.dataTransfer.files || []);
    setCsvSelection(files);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
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
      body.append("agentId", AGENT_ID);

      const response = await fetch("/api/onboard/crm-upload", {
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
        totals: data.totals || {
          rowsTotal: 0,
          rowsImported: 0,
          rowsSkipped: 0,
        },
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

  const leadsSummary =
    successPayload &&
    Array.isArray(successPayload.leads) &&
    successPayload.leads.length > 0
      ? `${successPayload.leads.slice(0, 5).join(", ")}${successPayload.leads.length > 5 ? `, +${successPayload.leads.length - 5} more` : ""}`
      : "—";

  return (
    <section className="rounded-xl border border-[var(--border)] border-dashed bg-[var(--surface)]/80 p-6">
      <p className="text-sm text-[var(--foreground)]">
        Required column: <code className="text-[var(--foreground)]">name</code>.
        Optional: phone, email, area, budget, bedrooms, last_contact, status, notes.{" "}
        <a
          href="/crm-template.csv"
          download
          className="underline underline-offset-2 hover:opacity-80"
        >
          Download template
        </a>
      </p>

      <div className="mt-4">
        <div className="block text-xs font-medium text-[var(--foreground)]">
          <span className="block">Lead list (.csv)</span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,text/csv"
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
              Drop .csv files here or click to choose
            </span>
            <span className="mt-1 text-xs text-[var(--foreground)]">
              Headers can be any common alias (phone / mobile / whatsapp, budget / max_budget, etc).
            </span>
          </div>
        </div>

        {selectedFiles.length > 0 && status !== "success" ? (
          <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--foreground)]">
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
              <p className="mt-1 text-[var(--foreground)]">
                +{selectedFiles.length - 5} more
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[var(--foreground)]">{TRUST_LINE}</p>

      <button
        type="button"
        disabled={uploading || selectedFiles.length === 0}
        onClick={() => handleUpload()}
        className={`mt-3 w-full rounded-lg border px-3 py-2 text-sm font-medium ${
          uploading || selectedFiles.length === 0
            ? "cursor-not-allowed border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)]"
            : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] hover:opacity-90"
        }`}
      >
        {uploading ? "Importing leads…" : "Import to knowledge base"}
      </button>

      {uploading ? (
        <p className="mt-2 text-center text-xs text-[var(--foreground)]" aria-live="polite">
          Parsing CSV and saving leads…
        </p>
      ) : null}

      {status === "success" && successPayload ? (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)]">
          <p className="font-medium text-[var(--foreground)]">Import complete</p>
          <ul className="mt-2 space-y-1 text-[var(--foreground)]">
            <li>
              <span className="text-[var(--foreground)]">Rows imported:</span>{" "}
              {successPayload.totals.rowsImported} of {successPayload.totals.rowsTotal}
            </li>
            {successPayload.totals.rowsSkipped > 0 ? (
              <li>
                <span className="text-[var(--foreground)]">Rows skipped:</span>{" "}
                {successPayload.totals.rowsSkipped}
              </li>
            ) : null}
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
                <p className="mt-1 text-xs text-[var(--foreground)]">
                  <span className="text-[var(--foreground)]">Saved as:</span>{" "}
                  {f.savedAs}
                </p>
                <p className="mt-1 text-xs text-[var(--foreground)]">
                  <span className="text-[var(--foreground)]">Mapped columns:</span>{" "}
                  <span className="text-[var(--foreground)]">
                    {Object.entries(f.headerMap || {})
                      .map(([raw, canon]) => `${raw} → ${canon}`)
                      .join(", ") || "—"}
                  </span>
                </p>
                {Array.isArray(f.unmappedHeaders) && f.unmappedHeaders.length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--foreground)]">
                    <span className="text-[var(--foreground)]">Extra columns kept as notes:</span>{" "}
                    {f.unmappedHeaders.join(", ")}
                  </p>
                ) : null}
                {Array.isArray(f.errors) && f.errors.length > 0 ? (
                  <details className="mt-2 text-xs text-[var(--foreground)]">
                    <summary className="cursor-pointer">
                      {f.errors.length} row warning{f.errors.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {f.errors.slice(0, 10).map((er, idx) => (
                        <li key={`${i}-err-${String(idx)}`}>
                          Row {er.row}: {er.message}
                        </li>
                      ))}
                      {f.errors.length > 10 ? (
                        <li>+{f.errors.length - 10} more…</li>
                      ) : null}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--foreground)]"
              onClick={resetToIdle}
            >
              Upload another CSV
            </button>
            {onAddMoreData ? (
              <button
                type="button"
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:opacity-90"
                onClick={onAddMoreData}
              >
                Add more data →
              </button>
            ) : null}
          </div>
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

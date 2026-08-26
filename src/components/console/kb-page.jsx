"use client";

import { useEffect, useState } from "react";
import { Drop } from "@/components/ui/drop";
import { Pill } from "@/components/ui/pill";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";

function fileType(filename) {
  const ext = String(filename || "").split(".").pop();
  if (!ext || ext === filename) return "FILE";
  return ext.slice(0, 4).toUpperCase();
}

function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function KbPage({ tenant }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function load() {
    const res = await fetch("/api/console/kb");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not load KB.");
    setDocs(body.documents || []);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function upload(files) {
    setError("");
    for (const file of files) {
      const form = new FormData();
      form.set("file", file);
      form.set("scope", "private");
      const res = await fetch("/api/console/kb", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Upload failed.");
    }
    await load();
  }

  async function patch(id, body) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/console/kb/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Update failed.");
      await load();
    } finally {
      setBusyId("");
    }
  }

  function act(id, body) {
    patch(id, body).catch((err) => setError(err.message));
  }

  return (
    <ConsoleShell tenant={tenant} width={880}>
      <h1 className="az-h1 mb-3 text-fg">Knowledge</h1>
      <p className="mb-9 max-w-[600px] text-lg leading-snug text-fg-2 [text-wrap:pretty]">
        Everything AgentZero is allowed to quote — on calls and when you ask it
        something on WhatsApp. If it is not here, it will not make it up.
      </p>

      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      <Drop
        accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg"
        className="mb-4"
        hint="Price lists, payment plans, brochures. PDF, TXT, MD, CSV, PNG, JPG."
        onFiles={(files) => upload(files).catch((err) => setError(err.message))}
      >
        Drop files here
      </Drop>

      <div className="az-eyebrow mb-3 mt-9 block">
        IN THE KNOWLEDGE BASE · {docs?.length ?? "…"}
      </div>
      <div className="border-t border-line">
        {docs == null ? (
          <>
            <div className="az-row h-[74px]" />
            <div className="az-row h-[74px]" />
          </>
        ) : docs.length === 0 ? (
          <p className="py-8 text-[15px] text-dim">
            Nothing in the knowledge base yet. Drop a price list above.
          </p>
        ) : (
          docs.map((doc) => (
            <div
              className="flex flex-wrap items-center gap-4 border-b border-hairline px-1 py-4.5"
              key={doc.id}
            >
              <span className="w-11 font-mono text-[11px] text-ghost">
                {fileType(doc.filename)}
              </span>
              <div className="min-w-[200px] flex-1">
                <div className="text-base text-fg">{doc.filename}</div>
                <div className="mt-1 text-[13px] text-faint">
                  {doc.index_status} · {fileSize(doc.bytes)}
                </div>
              </div>
              {doc.inherited ? <Pill tone="live">Inherited</Pill> : null}
              {doc.mine && doc.scope === "private" ? (
                <button
                  className="text-sm text-faint hover:text-fg disabled:opacity-40"
                  disabled={busyId === doc.id}
                  onClick={() => act(doc.id, { scope: "tenant" })}
                  type="button"
                >
                  Share with team
                </button>
              ) : null}
              {doc.mine && doc.scope === "tenant" ? (
                <button
                  className="text-sm text-faint hover:text-fg disabled:opacity-40"
                  disabled={busyId === doc.id}
                  onClick={() => act(doc.id, { scope: "private" })}
                  type="button"
                >
                  Make private
                </button>
              ) : null}
              {doc.inherited ? (
                <button
                  className="text-sm text-faint hover:text-fg disabled:opacity-40"
                  disabled={busyId === doc.id}
                  onClick={() => act(doc.id, { hide: true })}
                  type="button"
                >
                  Hide
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="mt-11 rounded-xl border border-line-2 bg-panel px-6 py-5.5 text-[15px] leading-relaxed text-fg-2">
        Try it now: text{" "}
        <span className="font-mono text-az">
          what is the payment plan on Emaar Beachfront?
        </span>{" "}
        and see what comes back.
      </div>
    </ConsoleShell>
  );
}

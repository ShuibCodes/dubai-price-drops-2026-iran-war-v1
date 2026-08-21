"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drop } from "@/components/ui/drop";
import { Pill } from "@/components/ui/pill";
import { Row } from "@/components/ui/row";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";

export function KbPage({ tenant }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");

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
    const res = await fetch(`/api/console/kb/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || "Update failed.");
    await load();
  }

  return (
    <ConsoleShell tenant={tenant} title="Knowledge">
      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}
      <Drop
        accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg"
        className="mb-8"
        onFiles={(files) => upload(files).catch((err) => setError(err.message))}
      >
        Drop price lists, payment plans, brochures.
      </Drop>
      <div className="border-t border-rule">
        {docs == null ? (
          <Row sub=" " title=" " />
        ) : docs.length === 0 ? (
          <p className="py-6 text-sm text-ink-2">Nothing in the KB yet.</p>
        ) : (
          docs.map((doc) => (
            <Row
              key={doc.id}
              right={
                <>
                  {doc.inherited ? <Pill tone="live">Inherited</Pill> : null}
                  {doc.mine && doc.scope === "private" ? (
                    <Button
                      onClick={() => patch(doc.id, { scope: "tenant" })}
                      variant="ghost"
                    >
                      Share with tenant
                    </Button>
                  ) : null}
                  {doc.mine && doc.scope === "tenant" ? (
                    <Button
                      onClick={() => patch(doc.id, { scope: "private" })}
                      variant="ghost"
                    >
                      Make private
                    </Button>
                  ) : null}
                  {doc.inherited ? (
                    <Button
                      onClick={() => patch(doc.id, { hide: true })}
                      variant="ghost"
                    >
                      Hide
                    </Button>
                  ) : null}
                </>
              }
              sub={`${doc.index_status} · ${doc.bytes || 0} bytes`}
              title={doc.filename}
            />
          ))
        )}
      </div>
    </ConsoleShell>
  );
}

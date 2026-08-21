"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Drop } from "@/components/ui/drop";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Row } from "@/components/ui/row";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";
import { estCostAed } from "@/lib/console/format";

const SOURCES = [
  { id: "upload", label: "Upload a list" },
  { id: "whatsapp", label: "From your WhatsApp" },
  { id: "segment", label: "Saved segment" },
];

export function RunBuilder({ tenant }) {
  const router = useRouter();
  const [source, setSource] = useState("whatsapp");
  const [scripts, setScripts] = useState([]);
  const [scriptId, setScriptId] = useState("");
  const [areas, setAreas] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [contacts, setContacts] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [home, setHome] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/scripts").then((res) => res.json()),
      fetch("/api/console/home").then((res) => res.json()),
    ])
      .then(([scriptBody, homeBody]) => {
        const live = (scriptBody.scripts || []).filter((row) => row.status === "live");
        setScripts(live);
        if (live[0]) setScriptId(live[0].id);
        setHome(homeBody);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (source === "upload") {
      setPreview({
        matched: contacts.length,
        exclusions: [],
      });
      return;
    }
    fetch("/api/console/runs/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_type: source,
        areas: areas.split(",").map((s) => s.trim()).filter(Boolean),
        bedrooms,
      }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Preview failed.");
        setPreview(body);
      })
      .catch((err) => setError(err.message));
  }, [source, areas, bedrooms, contacts.length]);

  function parseCsv(files) {
    const file = files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = (result.data || [])
          .map((row) => ({
            phone: row.phone || row.Phone || row.mobile || row.wa_id,
            name: row.name || row.Name || row.push_name,
          }))
          .filter((row) => row.phone);
        setContacts(rows);
      },
    });
  }

  async function commit() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/console/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_type: source,
          script_id: scriptId,
          areas: areas.split(",").map((s) => s.trim()).filter(Boolean),
          bedrooms,
          window_start: windowStart || null,
          contacts,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not start the run.");
      router.push(`/copilot/${encodeURIComponent(tenant)}/runs/${body.batch_id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const matched = preview?.matched || 0;
  const selected = scripts.find((row) => row.id === scriptId);

  return (
    <ConsoleShell tenant={tenant} title="New call run">
      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      <Label>Source</Label>
      <div className="mb-6 flex flex-wrap gap-2">
        {SOURCES.map((item) => (
          <button
            className={`rounded-md border px-3 py-1.5 text-sm ${
              source === item.id ? "border-ink bg-ink text-background" : "border-dotted border-ink-2"
            }`}
            key={item.id}
            onClick={() => setSource(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {source === "upload" ? (
        <Drop accept=".csv,text/csv" className="mb-6" onFiles={parseCsv}>
          {contacts.length ? `${contacts.length} numbers from the file.` : "Drop a CSV with phone and name columns."}
        </Drop>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="areas">Areas</Label>
            <Field
              id="areas"
              onChange={(e) => setAreas(e.target.value)}
              placeholder="Marina, JVC"
              value={areas}
            />
          </div>
          <div>
            <Label htmlFor="beds">Bedrooms</Label>
            <Field
              id="beds"
              onChange={(e) => setBedrooms(e.target.value)}
              placeholder="2"
              value={bedrooms}
            />
          </div>
        </div>
      )}

      <Strip className="mb-6" tone="default">
        <span>
          {matched} match
          {(preview?.exclusions || []).length
            ? ` — ${(preview.exclusions || [])
                .map((item) => `${item.n} excluded (${item.reason})`)
                .join(", ")}`
            : ""}
        </span>
      </Strip>

      <Label>Live scripts only</Label>
      <div className="mb-6 border-t border-rule">
        {scripts.length === 0 ? (
          <p className="py-4 text-sm text-ink-2">Publish a script before you dial.</p>
        ) : (
          scripts.map((script) => (
            <Row
              key={script.id}
              onClick={() => setScriptId(script.id)}
              right={
                scriptId === script.id ? <Pill tone="live">Selected</Pill> : <Pill>Live</Pill>
              }
              sub={script.goal_label || "Live"}
              title={script.display_name}
            />
          ))
        )}
      </div>

      <div className="mb-6">
        <Label htmlFor="window">Window start</Label>
        <Field
          id="window"
          onChange={(e) => setWindowStart(e.target.value)}
          type="datetime-local"
          value={windowStart}
        />
      </div>

      <div className="border border-rule-2 bg-surface p-4">
        <p className="font-mono text-[10px] uppercase tracking-label text-ink-3">
          Confirm
        </p>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          Caller ID: {home?.tenant?.display_phone || "your AgentZero line"}.
          AI disclosure is required on every call. Estimate AED {estCostAed(matched)} for{" "}
          {matched} dials
          {selected ? ` with ${selected.display_name}` : ""}.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={saving || !scriptId || matched < 1} onClick={commit}>
            {saving ? "Queueing…" : "Start the run"}
          </Button>
          {scriptId ? (
            <Button
              onClick={() =>
                router.push(`/copilot/${encodeURIComponent(tenant)}/scripts/${scriptId}`)
              }
              type="button"
              variant="secondary"
            >
              Test on my own number first
            </Button>
          ) : null}
        </div>
      </div>
    </ConsoleShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Drop } from "@/components/ui/drop";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Row } from "@/components/ui/row";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";
import { estCostAed } from "@/lib/console/format";
import {
  contactsFromCsvText,
  isSpreadsheetFile,
  readFileText,
} from "@/lib/console/list-csv";

const SOURCES = [
  { id: "upload", label: "Upload a list" },
  { id: "whatsapp", label: "From your WhatsApp" },
  { id: "segment", label: "Saved list" },
];

export function RunBuilder({ tenant }) {
  const router = useRouter();
  const [source, setSource] = useState("whatsapp");
  const [scripts, setScripts] = useState([]);
  const [scriptId, setScriptId] = useState("");
  const [areas, setAreas] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [listName, setListName] = useState("");
  const [lists, setLists] = useState([]);
  const [windowStart, setWindowStart] = useState("");
  const [contacts, setContacts] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [home, setHome] = useState(null);

  function loadLists() {
    return fetch("/api/console/lists")
      .then((res) => res.json())
      .then((body) => setLists(body.lists || []))
      .catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/scripts").then((res) => res.json()),
      fetch("/api/console/home").then((res) => res.json()),
      loadLists(),
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
        list_name: listName,
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
  }, [source, areas, bedrooms, contacts.length, listName]);

  async function parseCsv(files) {
    const file = files[0];
    if (!file) return;
    setError("");
    setSavedMsg("");
    if (isSpreadsheetFile(file)) {
      setContacts([]);
      setError("That is an Excel workbook. Save it as CSV (comma separated) and drop that file.");
      return;
    }
    try {
      const text = await readFileText(file);
      const { contacts: rows, parseError } = contactsFromCsvText(text);
      setContacts(rows);
      if (!rows.length) {
        setError(
          parseError
            ? `Could not read the file: ${parseError}`
            : "No phone numbers found in that file. Names can use any header — we only need a number on each row."
        );
      }
    } catch (err) {
      setContacts([]);
      setError(err.message || "Could not read that file.");
    }
  }

  async function saveList() {
    setSavingList(true);
    setError("");
    setSavedMsg("");
    try {
      const res = await fetch("/api/console/lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: listName, contacts }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save the list.");
      await loadLists();
      setSavedMsg(
        `Saved ${body.saved} as “${body.name}”. No calls yet. Later, in WhatsApp: call my ${body.name} with the cold list script.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingList(false);
    }
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
          list_name: listName,
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
  const canSave = source === "upload" && contacts.length > 0 && listName.trim().length >= 2;
  const canStart =
    Boolean(scriptId) &&
    matched > 0 &&
    (source !== "upload" || listName.trim().length >= 2) &&
    (source !== "segment" || listName.trim().length >= 2);

  return (
    <ConsoleShell tenant={tenant} title="New call run">
      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}
      {savedMsg ? (
        <Strip className="mb-4" tone="live">
          <span>{savedMsg}</span>
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
            onClick={() => {
              setSource(item.id);
              if (item.id !== "segment") setSavedMsg("");
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {source === "upload" ? (
        <>
          <div className="mb-4">
            <Label htmlFor="list-name">Name this list</Label>
            <Field
              id="list-name"
              onChange={(e) => setListName(e.target.value)}
              placeholder="Marina August"
              value={listName}
            />
            <p className="mt-1 text-sm text-ink-3">
              You will call it by this name in WhatsApp: call my Marina August with the cold list script.
            </p>
          </div>
          <Drop
            accept=".csv,.txt,text/csv,text/plain,application/csv,application/vnd.ms-excel"
            className="mb-4"
            onFiles={(files) => parseCsv(files)}
          >
            {contacts.length
              ? `${contacts.length} numbers from the file.`
              : "CSV with names and numbers. Headers can be anything."}
          </Drop>
          {contacts.length ? (
            <div className="mb-4 border-t border-rule">
              {contacts.slice(0, 25).map((row, index) => (
                <Row
                  key={`${row.phone}-${index}`}
                  sub={row.phone}
                  title={row.name || row.phone}
                />
              ))}
              {contacts.length > 25 ? (
                <p className="py-3 text-sm text-ink-3">
                  And {contacts.length - 25} more.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="mb-6">
            <Button disabled={savingList || !canSave} onClick={saveList} variant="secondary">
              {savingList ? "Saving…" : "Save the list, don’t call yet"}
            </Button>
          </div>
        </>
      ) : (
        <>
          {source === "segment" ? (
            <div className="mb-4">
              <Label>Saved lists</Label>
              {lists.length === 0 ? (
                <p className="mb-3 text-sm text-ink-2">
                  No saved lists yet. Upload a CSV and save it without calling.
                </p>
              ) : (
                <div className="mb-4 flex flex-wrap gap-2">
                  {lists.map((item) => (
                    <button
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        listName === item.name
                          ? "border-ink bg-ink text-background"
                          : "border-dotted border-ink-2"
                      }`}
                      key={item.name}
                      onClick={() => setListName(item.name)}
                      type="button"
                    >
                      {item.name}
                      <span className="ml-2 font-mono text-[10px] opacity-70">{item.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
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
        </>
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
          {selected ? ` with ${selected.display_name}` : ""}
          {windowStart ? ", starting at the window you set" : ""}.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={saving || !canStart} onClick={commit}>
            {saving ? "Queueing…" : windowStart ? "Schedule the run" : "Start the run"}
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

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Drop } from "@/components/ui/drop";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";
import { consoleBase, consoleJson } from "@/lib/console/client";
import { estCostAed, waDeepLink } from "@/lib/console/format";
import {
  contactsFromCsvText,
  isSpreadsheetFile,
  readFileText,
} from "@/lib/console/list-csv";

const SOURCES = [
  { id: "segment", label: "A saved list" },
  { id: "upload", label: "Upload a new CSV" },
  { id: "whatsapp", label: "From your WhatsApp" },
];

function localValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function thisEvening() {
  const date = new Date();
  if (date.getHours() >= 17) date.setDate(date.getDate() + 1);
  date.setHours(17, 0, 0, 0);
  return localValue(date);
}

function tomorrowMorning() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return localValue(date);
}

function StepHead({ n, children }) {
  return (
    <div className="mb-3.5 flex items-baseline gap-3">
      <div className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-az text-[13px] font-bold text-az-ink">
        {n}
      </div>
      <div className="text-[21px] font-semibold text-fg">{children}</div>
    </div>
  );
}

function Radio({ on, title, sub, right, onClick }) {
  return (
    <button
      className={`flex w-full items-center gap-3.5 rounded-[11px] border px-5 py-4.5 text-left ${
        on ? "border-az bg-az-wash" : "border-line-2 bg-panel hover:border-line-3"
      }`}
      onClick={onClick}
      type="button"
    >
      <span
        className={
          on
            ? "h-[18px] w-[18px] flex-none rounded-full border-[5px] border-az bg-az-ink"
            : "h-[18px] w-[18px] flex-none rounded-full border border-line-4"
        }
      />
      <div className="min-w-0 flex-1">
        <div className="text-[17px] font-medium text-fg">{title}</div>
        <div className="mt-1 text-[13px] text-faint">{sub}</div>
      </div>
      {right}
    </button>
  );
}

function Tab({ on, children, onClick }) {
  return (
    <button
      className={on ? "az-btn-white" : "az-btn-quiet"}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function RunBuilder({ tenant }) {
  const router = useRouter();
  const [source, setSource] = useState("segment");
  const [scripts, setScripts] = useState([]);
  const [scriptId, setScriptId] = useState("");
  const [areas, setAreas] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [listName, setListName] = useState("");
  const [lists, setLists] = useState([]);
  const [windowStart, setWindowStart] = useState("");
  const [pickTime, setPickTime] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [home, setHome] = useState(null);
  const base = consoleBase(tenant);

  const loadLists = useCallback(
    () =>
      consoleJson(base, "/api/console/lists")
        .then((body) => setLists(body.lists || []))
        .catch(() => {}),
    [base]
  );

  useEffect(() => {
    Promise.all([
      consoleJson(base, "/api/scripts", { fallback: "Could not load scripts." }),
      consoleJson(base, "/api/console/home", { fallback: "Could not load the console." }),
      loadLists(),
    ])
      .then(([scriptBody, homeBody]) => {
        const live = (scriptBody.scripts || []).filter((row) => row.status === "live");
        setScripts(live);
        if (live[0]) setScriptId(live[0].id);
        setHome(homeBody);
      })
      .catch((err) => setError(err.message));
  }, [base, loadLists]);

  useEffect(() => {
    if (source === "upload") {
      setPreview({ matched: contacts.length, exclusions: [] });
      return undefined;
    }
    // An unnamed list is not "every lead in the tenant" — the matcher drops the
    // source filter when the name is blank, so don't ask until one is picked.
    if (source === "segment" && listName.trim().length < 2) {
      setPreview(null);
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      consoleJson(base, "/api/console/runs/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        fallback: "Preview failed.",
        body: JSON.stringify({
          source_type: source,
          list_name: listName,
          areas: areas.split(",").map((s) => s.trim()).filter(Boolean),
          bedrooms,
        }),
      })
        .then(setPreview)
        .catch((err) => {
          if (err.name !== "AbortError") setError(err.message);
        });
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, source, areas, bedrooms, contacts.length, listName]);

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
      const body = await consoleJson(base, "/api/console/lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        fallback: "Could not save the list.",
        body: JSON.stringify({ name: listName, contacts }),
      });
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
      const body = await consoleJson(base, "/api/console/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        fallback: "Could not start the run.",
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
      if (!body.batch_id) {
        throw new Error(
          `Queued ${body.queued || 0} calls, but the run has no id to open. Check Home for the run.`
        );
      }
      router.push(`${base}/runs/${body.batch_id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const needsList = source === "segment" && listName.trim().length < 2;
  const counting = preview == null && !needsList;
  const matched = preview?.matched || 0;
  const exclusions = preview?.exclusions || [];
  const skipped = exclusions.reduce((total, item) => total + (Number(item.n) || 0), 0);
  const selected = scripts.find((row) => row.id === scriptId);
  const canSave = source === "upload" && contacts.length > 0 && listName.trim().length >= 2;
  const canStart =
    Boolean(scriptId) &&
    matched > 0 &&
    (source !== "upload" || listName.trim().length >= 2) &&
    (source !== "segment" || listName.trim().length >= 2);

  return (
    <ConsoleShell
      tenant={tenant}
      waLink={
        home ? waDeepLink(home.tenant?.display_phone || home.agent?.wa_id) : undefined
      }
      width={760}
    >
      <h1 className="az-h1 mb-3 text-fg">New call run</h1>
      <p className="mb-3 text-lg leading-snug text-fg-2">
        Nothing dials until the last button. You will see exactly how many people
        and what it costs first.
      </p>
      <Link className="mb-11 inline-block text-base text-az" href={base}>
        See past runs →
      </Link>

      {error ? (
        <Strip className="mb-6" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}
      {savedMsg ? (
        <Strip className="mb-6" tone="live">
          <span>{savedMsg}</span>
        </Strip>
      ) : null}

      <StepHead n={1}>Who are we calling?</StepHead>
      <div className="mb-5 flex flex-wrap gap-2 pl-[38px]">
        {SOURCES.map((item) => (
          <Tab
            key={item.id}
            on={source === item.id}
            onClick={() => {
              setSource(item.id);
              if (item.id !== "segment") setSavedMsg("");
            }}
          >
            {item.label}
          </Tab>
        ))}
      </div>

      <div className="mb-10 pl-[38px]">
        {source === "segment" ? (
          lists.length === 0 ? (
            <p className="text-[15px] text-dim">
              No saved lists yet. Upload a CSV and save it without calling.
            </p>
          ) : (
            <div className="grid gap-2.5">
              {lists.map((item) => (
                <Radio
                  key={item.name}
                  on={listName === item.name}
                  onClick={() => setListName(item.name)}
                  sub={`${item.count} numbers`}
                  title={item.name}
                />
              ))}
            </div>
          )
        ) : null}

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
              <p className="mt-2 text-[13px] text-faint">
                You will call it by this name in WhatsApp: call my Marina August
                with the cold list script.
              </p>
            </div>
            <Drop
              accept=".csv,.txt,text/csv,text/plain,application/csv,application/vnd.ms-excel"
              className="mb-4"
              hint="Headers can be anything — we only need a number on each row."
              onFiles={(files) => parseCsv(files)}
            >
              {contacts.length
                ? `${contacts.length} numbers from the file`
                : "Drop a CSV here"}
            </Drop>
            {contacts.length ? (
              <div className="mb-4 border-t border-line">
                {contacts.slice(0, 25).map((row, index) => (
                  <div
                    className="flex items-center gap-4 border-b border-hairline px-1 py-3"
                    key={`${row.phone}-${index}`}
                  >
                    <span className="flex-1 text-[15px] text-fg">
                      {row.name || row.phone}
                    </span>
                    <span className="font-mono text-[13px] text-faint">
                      {row.phone}
                    </span>
                  </div>
                ))}
                {contacts.length > 25 ? (
                  <p className="py-3 text-[13px] text-faint">
                    And {contacts.length - 25} more.
                  </p>
                ) : null}
              </div>
            ) : null}
            <Button
              disabled={savingList || !canSave}
              onClick={saveList}
              variant="secondary"
            >
              {savingList ? "Saving…" : "Save the list, don’t call yet"}
            </Button>
          </>
        ) : null}

        {source === "whatsapp" ? (
          <div className="grid gap-4.5 sm:grid-cols-2">
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
        ) : null}
      </div>

      <StepHead n={2}>Which script?</StepHead>
      <div className="mb-10 pl-[38px]">
        {scripts.length === 0 ? (
          <p className="text-[15px] text-dim">
            Drafts don’t appear here.{" "}
            <Link className="text-az" href={`${base}/scripts`}>
              Publish one →
            </Link>
          </p>
        ) : (
          <>
            <div className="grid gap-2.5">
              {scripts.map((script) => (
                <Radio
                  key={script.id}
                  on={scriptId === script.id}
                  onClick={() => setScriptId(script.id)}
                  right={
                    <span className="font-mono text-[10px] tracking-[.12em] text-az">
                      LIVE
                    </span>
                  }
                  sub={script.goal_label || "Live script"}
                  title={
                    <>
                      {script.display_name}{" "}
                      <span className="font-mono text-[11px] text-az">
                        v{script.current_version}
                      </span>
                    </>
                  }
                />
              ))}
            </div>
            <div className="mt-2.5 text-sm text-faint">
              Drafts don’t appear here.{" "}
              <Link className="text-az" href={`${base}/scripts`}>
                Publish one →
              </Link>
            </div>
          </>
        )}
      </div>

      <StepHead n={3}>When should it start?</StepHead>
      <div className="mb-11 pl-[38px]">
        <div className="mb-3.5 flex flex-wrap gap-2">
          <Tab
            on={!windowStart && !pickTime}
            onClick={() => {
              setWindowStart("");
              setPickTime(false);
            }}
          >
            As soon as possible
          </Tab>
          <Tab
            on={windowStart === thisEvening() && !pickTime}
            onClick={() => {
              setWindowStart(thisEvening());
              setPickTime(false);
            }}
          >
            This evening, 17:00
          </Tab>
          <Tab
            on={windowStart === tomorrowMorning() && !pickTime}
            onClick={() => {
              setWindowStart(tomorrowMorning());
              setPickTime(false);
            }}
          >
            Tomorrow morning
          </Tab>
          <Tab on={pickTime} onClick={() => setPickTime(true)}>
            Pick a time
          </Tab>
        </div>
        {pickTime ? (
          <div className="mb-3.5">
            <Label htmlFor="window">Start at</Label>
            <Field
              id="window"
              onChange={(e) => setWindowStart(e.target.value)}
              type="datetime-local"
              value={windowStart}
            />
          </div>
        ) : null}
        <div className="text-sm text-faint">
          Calls only go out inside calling hours, {home?.agent?.tz || "Asia/Dubai"}{" "}
          time. Anything outside waits.
        </div>
      </div>

      <div className="rounded-2xl border border-az-edge bg-az-wash p-7">
        <div className="mb-5 font-mono text-[11px] tracking-[.16em] text-az">
          BEFORE YOU START
        </div>
        <div className="mb-5.5 flex flex-wrap gap-9">
          <div>
            <div className="text-[40px] font-semibold leading-none tracking-[-.03em] text-fg">
              {matched}
            </div>
            <div className="mt-1.5 text-sm text-dim">will be called</div>
          </div>
          <div>
            <div className="text-[40px] font-semibold leading-none tracking-[-.03em] text-dim">
              {skipped}
            </div>
            <div className="mt-1.5 text-sm text-dim">skipped</div>
          </div>
          <div>
            <div className="text-[40px] font-semibold leading-none tracking-[-.03em] text-fg">
              AED {estCostAed(matched)}
            </div>
            <div className="mt-1.5 text-sm text-dim">estimated</div>
          </div>
        </div>
        <div className="grid gap-1.5 border-b border-[#1d3327] pb-5.5 text-sm text-dim">
          {needsList ? (
            <div>Pick a saved list to see who is in it.</div>
          ) : counting ? (
            <div>Counting who is in this list…</div>
          ) : exclusions.length ? (
            <div>
              {exclusions
                .map((item) => `${item.n} ${item.reason}`)
                .join(" · ")}
            </div>
          ) : (
            <div>Nobody excluded from this list.</div>
          )}
          <div>
            Caller ID: {home?.tenant?.display_phone || "your AgentZero line"}.
            Every call states it is an AI.
          </div>
        </div>
        <div className="mt-5.5 flex flex-wrap gap-3">
          <Button disabled={saving || !canStart} onClick={commit}>
            {saving
              ? "Queueing…"
              : needsList
                ? "Pick a list first"
                : counting
                  ? "Counting…"
                  : windowStart
                    ? `Schedule ${matched} calls`
                    : `Start calling ${matched} people`}
          </Button>
          {scriptId ? (
            <Button
              onClick={() => router.push(`${base}/scripts/${scriptId}`)}
              variant="secondary"
            >
              Test on my own number first
            </Button>
          ) : null}
        </div>
        <div className="mt-4.5 text-sm text-dim">
          Results land in your WhatsApp as they come in. You don’t need to sit
          here.
        </div>
      </div>
    </ConsoleShell>
  );
}

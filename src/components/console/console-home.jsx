"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";
import { Tooltip } from "@/components/console/tooltip";
import { consoleBase, consoleJson } from "@/lib/console/client";
import { waDeepLink } from "@/lib/console/format";

function greeting(tz) {
  let hour = new Date().getHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        hour12: false,
        timeZone: tz || "Asia/Dubai",
      }).format(new Date())
    );
  } catch {
    // fall back to the browser clock
  }
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function runMeta(run, tz) {
  const when = new Date(run.created_at)
    .toLocaleString("en-GB", {
      timeZone: tz || "Asia/Dubai",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .toUpperCase();
  const dialed = run.counts?.dialed ?? 0;
  return `${when} · ${run.script_name.toUpperCase()} · ${dialed} DIALLED`;
}

function Chip({ tone, children }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-full border px-4 py-2.5 text-sm ${
        tone === "ok"
          ? "border-az-edge bg-az-wash text-az"
          : "border-warn-edge bg-warn-wash text-warn"
      }`}
    >
      <span
        className={`h-[7px] w-[7px] rounded-full ${tone === "ok" ? "bg-az" : "bg-warn"}`}
      />
      {children}
    </div>
  );
}

function StepRow({ step, primary }) {
  const kind = step.done ? "quiet" : primary ? "primary" : "ghost";
  return (
    <div
      className={`flex items-start gap-4.5 border-b border-hairline px-6.5 py-5.5 last:border-0 ${
        step.done ? "" : "bg-panel-2"
      }`}
    >
      <div
        className={`grid h-7 w-7 flex-none place-items-center rounded-full text-sm ${
          step.done
            ? "bg-az font-bold text-az-ink"
            : "border border-line-4 font-mono text-dim"
        }`}
      >
        {step.done ? "✓" : step.n}
      </div>
      <div className="min-w-[200px] flex-1">
        <div className="flex items-center gap-2 text-[17px] font-medium text-fg">
          {step.title}
          {step.tip ? <Tooltip>{step.tip}</Tooltip> : null}
        </div>
        <div className={`mt-1 text-sm ${step.done ? "text-faint" : "text-dim"}`}>
          {step.sub}
        </div>
      </div>
      <Link
        className={`flex-none rounded-lg px-4 py-2.5 text-sm ${
          kind === "primary"
            ? "bg-az font-semibold text-az-ink hover:bg-az-hover"
            : kind === "ghost"
              ? "border border-line-3 text-fg hover:border-az hover:text-az"
              : "border border-line-2 text-dim hover:text-fg"
        }`}
        href={step.href}
      >
        {step.done ? "Manage" : step.cta}
      </Link>
    </div>
  );
}

export function ConsoleHome({ tenant }) {
  const [data, setData] = useState(null);
  const [scripts, setScripts] = useState(null);
  const [docs, setDocs] = useState(null);
  const [lists, setLists] = useState(null);
  const [error, setError] = useState("");
  const base = consoleBase(tenant);

  useEffect(() => {
    let live = true;

    const readJson = (url) =>
      consoleJson(base, url, { fallback: "Could not load the console." });

    (async () => {
      try {
        const home = await readJson("/api/console/home");
        if (!live) return;
        setData(home);
        const [scriptBody, kbBody, listBody] = await Promise.all([
          readJson("/api/scripts").catch(() => ({ scripts: [] })),
          readJson("/api/console/kb").catch(() => ({ documents: [] })),
          readJson("/api/console/lists").catch(() => ({ lists: [] })),
        ]);
        if (!live) return;
        setScripts(scriptBody?.scripts || []);
        setDocs(kbBody?.documents || []);
        setLists(listBody?.lists || []);
      } catch (err) {
        if (live) setError(err.message);
      }
    })();

    return () => {
      live = false;
    };
  }, [base]);

  const tz = data?.agent?.tz || "Asia/Dubai";
  const healthy = Boolean(data?.tenant?.whatsapp_healthy);
  const briefOn = data?.agent?.brief_enabled !== false;
  const briefTime = String(data?.agent?.brief_time || "07:30").slice(0, 5);
  const waLink = waDeepLink(data?.tenant?.display_phone || data?.agent?.wa_id);
  const liveScripts = (scripts || []).filter((row) => row.status === "live");
  const firstName = String(data?.agent?.name || "").trim().split(/\s+/)[0];

  const steps = [
    {
      n: 1,
      done: healthy,
      title: healthy ? "WhatsApp connected" : "Connect your WhatsApp",
      sub: healthy
        ? `${data?.tenant?.display_phone || "Brokerage number"} · connected via Meta`
        : "The number your leads already know. AgentZero listens on it and texts you back.",
      cta: "Connect →",
      href: healthy ? `${base}/settings` : `${base}/join`,
    },
    {
      n: 2,
      done: (docs || []).length > 0,
      title: "Knowledge added",
      sub:
        (docs || []).length > 0
          ? `${docs.length} file${docs.length === 1 ? "" : "s"} AgentZero can quote from`
          : "Price lists, payment plans, brochures. If it is not here, it will not make it up.",
      cta: "Upload →",
      href: `${base}/kb`,
      tip: "This is what AgentZero quotes from — on calls and when you ask it a question at midnight.",
    },
    {
      n: 3,
      done: liveScripts.length > 0,
      title: "One script live",
      sub:
        liveScripts.length > 0
          ? `${liveScripts[0].display_name} · v${liveScripts[0].current_version}`
          : "Only a LIVE script can call a list. Drafts are yours to play with.",
      cta: "Open the editor →",
      href: `${base}/scripts`,
    },
    {
      n: 4,
      done: Boolean(data?.agent?.onboarded_at),
      title: "Your morning brief",
      sub: briefOn
        ? `One text every morning at ${briefTime}. Overnight leads, who is worth a call.`
        : "Currently off. Turn it on to get the overnight shortlist on your phone.",
      cta: "Set it up →",
      href: `${base}/join`,
      tip: "Overnight leads, who's worth a call, who went quiet. On your phone, before your first coffee.",
    },
    {
      n: 5,
      done: (lists || []).length > 0,
      title: "Save your first list",
      sub:
        (lists || []).length > 0
          ? `${lists.length} saved list${lists.length === 1 ? "" : "s"} · call them by name in WhatsApp`
          : "Drop a CSV, give it a name. Nothing gets dialled until you say so.",
      cta: "Upload →",
      href: `${base}/runs/new`,
    },
  ];

  const loaded = data != null && scripts != null;
  const done = steps.filter((step) => step.done).length;
  const firstOpen = steps.find((step) => !step.done);

  return (
    <ConsoleShell tenant={tenant} waLink={waLink} width={1040}>
      {error ? (
        <Strip className="mb-8" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      <h1 className="mb-2.5 text-[46px] font-semibold leading-[1.02] tracking-[-.03em] text-fg">
        {greeting(tz)}
        {firstName ? `, ${firstName}` : ""}.
      </h1>
      <p className="mb-8 text-lg text-dim">
        {loaded
          ? done === steps.length
            ? "Everything is set up. AgentZero is calling for you."
            : `${done} of ${steps.length} things set up. Finish the rest and AgentZero starts calling for you.`
          : "Checking what is set up…"}
      </p>

      <div className="mb-10 flex flex-wrap gap-2.5">
        <Chip tone={healthy ? "ok" : "warn"}>
          WhatsApp {healthy ? "connected" : "not connected"}
        </Chip>
        <Chip tone={briefOn ? "ok" : "warn"}>
          {briefOn ? `Morning brief ${briefTime}` : "Morning brief off"}
        </Chip>
        <Chip tone={liveScripts.length > 0 ? "ok" : "warn"}>
          {liveScripts.length > 0
            ? `${liveScripts.length} script${liveScripts.length === 1 ? "" : "s"} live`
            : "No script live yet"}
        </Chip>
      </div>

      <div className="mb-11 overflow-hidden rounded-2xl border border-line-2 bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6.5 py-5.5">
          <div>
            <div className="text-[19px] font-semibold text-fg">Your setup</div>
            <div className="mt-1 text-sm text-dim">
              Do these once. They stay here so you can change them any week.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-[120px] overflow-hidden rounded-full bg-[#1c211f]">
              <div
                className="h-full bg-az transition-all"
                style={{ width: `${(done / steps.length) * 100}%` }}
              />
            </div>
            <span className="font-mono text-xs text-faint">
              {done}/{steps.length}
            </span>
          </div>
        </div>

        {steps.map((step) => (
          <StepRow
            key={step.n}
            primary={firstOpen?.n === step.n}
            step={step}
          />
        ))}
      </div>

      <div className="mb-4.5 flex items-center justify-between gap-4">
        <div className="az-eyebrow">RECENT RUNS</div>
        <Link className="az-btn-white" href={`${base}/runs/new`}>
          New call run
        </Link>
      </div>
      <div className="border-t border-line">
        {data == null ? (
          <>
            <div className="az-row h-[86px]" />
            <div className="az-row h-[86px]" />
          </>
        ) : data.runs.length === 0 ? (
          <p className="py-8 text-[15px] text-dim">
            No runs yet. Save a list, then start one.
          </p>
        ) : (
          data.runs.map((run) => (
            <Link
              className="az-row hover:bg-panel"
              href={`${base}/runs/${run.id}`}
              key={run.id}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-medium text-fg">
                  {run.script_name}
                </div>
                <div className="mt-1 font-mono text-[13px] text-faint">
                  {runMeta(run, tz)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[17px] font-medium text-az">
                  {run.counts?.qualified ?? 0} qualified
                </div>
                <div className="mt-1 text-[13px] text-faint">
                  {run.counts?.queued ?? 0} queued
                </div>
              </div>
              <span className="text-lg text-ghost">→</span>
            </Link>
          ))
        )}
      </div>
    </ConsoleShell>
  );
}

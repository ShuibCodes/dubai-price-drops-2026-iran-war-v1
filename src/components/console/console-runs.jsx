"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console/console-shell";
import { Strip } from "@/components/ui/strip";
import { consoleBase, consoleJson } from "@/lib/console/client";
import {
  runIsInFlight,
  runIsScheduled,
  runProgressLabel,
  tenantWhatsAppLink,
} from "@/lib/console/format";

function runMeta(run, tz) {
  const when = new Date(run.created_at)
    .toLocaleString("en-GB", {
      timeZone: tz || "Asia/Dubai",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .toUpperCase();
  const script = String(run.script_name || "").toUpperCase();
  const dialed = Number(run.counts?.dialed || 0);
  if (runIsScheduled(run) && dialed < 1) {
    return `${when} · ${script} · SCHEDULED`;
  }
  if (runIsInFlight(run) && dialed < 1) {
    return `${when} · ${script} · DIALLING…`;
  }
  return `${when} · ${script} · ${dialed} DIALLED`;
}

export function ConsoleRuns({ tenant }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [pausing, setPausing] = useState(false);
  const [pausedOverride, setPausedOverride] = useState(null);
  const base = consoleBase(tenant);

  useEffect(() => {
    consoleJson(base, "/api/console/home", { fallback: "Could not load runs." })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [base]);

  const tz = data?.agent?.tz || "Asia/Dubai";
  const paused = pausedOverride ?? Boolean(data?.tenant?.outbound_paused);

  async function setCallsPaused(next) {
    setPausing(true);
    setError("");
    try {
      const body = await consoleJson(base, "/api/console/calls/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        fallback: next ? "Could not pause calls." : "Could not resume calls.",
        body: JSON.stringify({ paused: next }),
      });
      setPausedOverride(Boolean(body.paused));
    } catch (err) {
      setError(err.message);
    } finally {
      setPausing(false);
    }
  }
  const waLink = tenantWhatsAppLink({
    connected: Boolean(data?.tenant?.whatsapp_healthy),
    displayPhone: data?.tenant?.display_phone,
  });
  const runs = data?.runs || [];

  return (
    <ConsoleShell tenant={tenant} waLink={waLink} width={1040}>
      {error ? (
        <Strip className="mb-8" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      <div className="mb-4.5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="az-eyebrow">RECENT RUNS</div>
          {Number(data?.tenant?.daily_dial_cap) > 0 &&
          Number(data?.tenant?.daily_dial_cap) < 200 ? (
            <p className="mt-2 text-[15px] text-dim">
              {Number(data.tenant.daily_dial_cap)} numbers a day on this plan.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            className={
              paused
                ? "az-btn-ghost"
                : "az-btn border border-transparent bg-markup font-semibold text-white hover:opacity-90"
            }
            disabled={pausing}
            onClick={() => setCallsPaused(!paused)}
            type="button"
          >
            {pausing ? "Saving…" : paused ? "Resume calls" : "Pause calls"}
          </button>
          <Link className="az-btn-white" href={`${base}/runs/new`}>
            New call run
          </Link>
        </div>
      </div>
      {paused ? (
        <Strip className="mb-4" tone="warn">
          <span>Calls are paused. Queued numbers stay queued and will not dial.</span>
        </Strip>
      ) : null}
      <div className="border-t border-line">
        {data == null ? (
          <>
            <div className="az-row h-[86px]" />
            <div className="az-row h-[86px]" />
          </>
        ) : runs.length === 0 ? (
          <p className="py-8 text-[15px] text-dim">
            No runs yet. Save a list, then start one.
          </p>
        ) : (
          runs.map((run) => (
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
                  {runProgressLabel(run)}
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

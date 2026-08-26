"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";
import { Expandable } from "@/components/console/expandable";

function metaLine(run) {
  if (!run) return "";
  const when = new Date(run.created_at)
    .toLocaleString("en-GB", {
      timeZone: "Asia/Dubai",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
    })
    .toUpperCase();
  return `${when} · ${run.script_name.toUpperCase()} · ${String(run.status || "").toUpperCase()}`;
}

function toneFor(call) {
  if (call.worth >= 50) return { label: "HOT", className: "text-az" };
  if (call.worth >= 30) return { label: "WARM", className: "text-az" };
  if (call.status === "queued") return { label: "QUEUED", className: "text-warn" };
  if (call.status === "failed") return { label: "FAILED", className: "text-markup" };
  return { label: String(call.status || "DONE").toUpperCase(), className: "text-faint" };
}

function CallBody({ call }) {
  return (
    <div className="border-b border-hairline px-1 pb-6 pt-5">
      {call.quote ? (
        <div className="rounded-r-[10px] border-l-2 border-az bg-az-wash px-5.5 py-5 text-[17px] italic leading-relaxed text-[#dce3df]">
          “{call.quote}”
        </div>
      ) : (
        <p className="text-[15px] text-dim">Nothing came back on this call yet.</p>
      )}
      {call.phone ? (
        <div className="mt-4 font-mono text-[13px] text-faint">{call.phone}</div>
      ) : null}
      <div className="mt-4.5 flex flex-wrap gap-2.5">
        {call.recording_url ? (
          <a
            className="az-btn-ghost"
            href={call.recording_url}
            rel="noreferrer"
            target="_blank"
          >
            ▶ Play recording
          </a>
        ) : null}
      </div>
      {call.transcript ? (
        <pre className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap rounded-[10px] border border-line-2 bg-field p-4 font-mono text-[11px] leading-relaxed text-dim">
          {call.transcript}
        </pre>
      ) : null}
    </div>
  );
}

export function RunResults({ tenant, runId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showRest, setShowRest] = useState(false);
  const base = `/copilot/${encodeURIComponent(tenant)}`;

  useEffect(() => {
    fetch(`/api/console/runs/${runId}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not load run.");
        setData(body);
      })
      .catch((err) => setError(err.message));
  }, [runId]);

  async function sendWhatsApp() {
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/console/runs/${runId}/whatsapp`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Send failed.");
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const stats = data?.stats || {};
  const calls = data?.calls || [];
  const hot = calls.filter((row) => row.worth >= 30);
  const rest = calls.filter((row) => row.worth < 30);

  return (
    <ConsoleShell tenant={tenant} width={880}>
      <Link
        className="mb-5 inline-block font-mono text-[11px] tracking-[.14em] text-faint hover:text-fg"
        href={base}
      >
        ← HOME
      </Link>
      <h1 className="mb-2 text-[44px] font-semibold leading-[1.02] tracking-[-.03em] text-fg">
        {data?.run?.script_name || "Run"}
      </h1>
      <div className="mb-10 font-mono text-xs tracking-[.1em] text-faint">
        {data ? metaLine(data.run) : "LOADING…"}
      </div>

      {error ? (
        <Strip className="mb-8" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}
      {sent ? (
        <Strip className="mb-8" tone="live">
          <span>Sent. Open WhatsApp to read the shortlist.</span>
        </Strip>
      ) : null}

      <div className="mb-11 flex flex-wrap gap-3.5">
        <Stat
          label="worth your time"
          n={hot.length}
          sub="already in your WhatsApp"
          tone="live"
        />
        <Stat label="qualified" n={stats.qualified ?? "—"} tone="ink" />
        <Stat label="dialled" n={stats.dialed ?? "—"} tone="dim" />
      </div>

      <div className="az-eyebrow mb-3.5 block">
        {hot.length ? `CALL THESE ${hot.length} BACK` : "NOBODY WORTH A CALLBACK YET"}
      </div>
      <div className="border-t border-line">
        {data == null ? (
          <>
            <div className="az-row h-[82px]" />
            <div className="az-row h-[82px]" />
          </>
        ) : hot.length === 0 ? (
          <p className="py-8 text-[15px] text-dim">
            {calls.length === 0
              ? "Nobody is on this run yet. If you just queued a list, go back and check the match count before Start."
              : "No callbacks yet. The calls below have the detail."}
          </p>
        ) : (
          hot.map((call, index) => {
            const tone = toneFor(call);
            return (
              <Expandable
                defaultOpen={index === 0}
                head={(open) => (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-lg font-medium text-fg">
                        {call.name}
                      </div>
                      <div className="mt-1 truncate text-sm text-dim">
                        {call.extracted || call.phone || "No detail captured"}
                      </div>
                    </div>
                    <span
                      className={`font-mono text-[11px] tracking-[.1em] ${tone.className}`}
                    >
                      {tone.label}
                    </span>
                    <span className="text-sm text-ghost">{open ? "▲" : "▼"}</span>
                  </>
                )}
                key={call.id}
              >
                <CallBody call={call} />
              </Expandable>
            );
          })
        )}
      </div>

      {rest.length ? (
        showRest ? (
          <div className="mt-5.5 border-t border-line">
            {rest.map((call) => {
              const tone = toneFor(call);
              return (
                <Expandable
                  head={(open) => (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-lg font-medium text-fg-soft">
                          {call.name}
                        </div>
                        <div className="mt-1 truncate text-sm text-dim">
                          {call.extracted || call.phone || "No detail captured"}
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[11px] tracking-[.1em] ${tone.className}`}
                      >
                        {tone.label}
                      </span>
                      <span className="text-sm text-ghost">{open ? "▲" : "▼"}</span>
                    </>
                  )}
                  key={call.id}
                >
                  <CallBody call={call} />
                </Expandable>
              );
            })}
          </div>
        ) : (
          <button
            className="mt-5.5 text-[15px] text-dim hover:text-fg"
            onClick={() => setShowRest(true)}
            type="button"
          >
            Show the other {rest.length} call{rest.length === 1 ? "" : "s"} (no
            interest, voicemail, queued)
          </button>
        )
      ) : null}

      <div className="mt-11 flex flex-wrap gap-3">
        <Button
          onClick={() => {
            window.location.href = `/api/console/runs/${runId}/export`;
          }}
          variant="secondary"
        >
          Export CSV
        </Button>
        <Button disabled={sending || !hot.length} onClick={sendWhatsApp} variant="quiet">
          {sending ? "Sending…" : `Send the ${hot.length} to my WhatsApp`}
        </Button>
      </div>
    </ConsoleShell>
  );
}

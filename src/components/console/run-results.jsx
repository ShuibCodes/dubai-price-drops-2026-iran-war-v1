"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Row } from "@/components/ui/row";
import { Stat } from "@/components/ui/stat";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";

export function RunResults({ tenant, runId }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

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
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const stats = data?.stats || {};
  const worth = (data?.calls || []).filter((row) => row.worth >= 30).length;

  return (
    <ConsoleShell
      action={
        data ? (
          <Pill tone={data.run.status === "complete" ? "live" : "warn"}>
            {data.run.status}
          </Pill>
        ) : null
      }
      tenant={tenant}
      title={data?.run.script_name || "Run"}
    >
      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      <div className="mb-8 grid grid-cols-3 gap-4">
        <Stat label="Dialed" n={stats.dialed ?? "—"} />
        <Stat label="Qualified" n={stats.qualified ?? "—"} />
        <Stat label="Worth your time" n={worth || "—"} />
      </div>

      <div className="border-t border-rule">
        {(data?.calls || []).map((call) => (
          <div key={call.id}>
            <Row
              onClick={() => setOpenId(openId === call.id ? null : call.id)}
              right={
                <Pill
                  tone={
                    call.worth >= 50
                      ? "live"
                      : call.status === "queued"
                        ? "warn"
                        : "required"
                  }
                >
                  {call.status}
                </Pill>
              }
              sub={call.extracted || call.phone}
              title={call.name}
            />
            {openId === call.id ? (
              <div className="border-b border-rule pb-4 pl-0 text-sm text-ink-2">
                {call.quote ? <p className="italic">“{call.quote}”</p> : null}
                {call.recording_url ? (
                  <p className="mt-2">
                    <a
                      className="underline underline-offset-2"
                      href={call.recording_url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Recording
                    </a>
                  </p>
                ) : null}
                {call.transcript ? (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-3">
                    {call.transcript}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {data && data.calls.length === 0 ? (
          <p className="py-6 text-sm text-ink-2">
            Nobody is on this run yet. If you just queued a list, go back and
            check the match count before Start.
          </p>
        ) : null}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button
          onClick={() => {
            window.location.href = `/api/console/runs/${runId}/export`;
          }}
          variant="secondary"
        >
          Export CSV
        </Button>
        <Button disabled={sending} onClick={sendWhatsApp} variant="ghost">
          {sending ? "Sending…" : `Send the ${worth} to my WhatsApp`}
        </Button>
      </div>
    </ConsoleShell>
  );
}

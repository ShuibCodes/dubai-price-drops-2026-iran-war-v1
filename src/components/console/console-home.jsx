"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Row } from "@/components/ui/row";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";
import { waDeepLink } from "@/lib/console/format";

function runSub(run) {
  const counts = run.counts || {};
  const dialed = counts.dialed ?? 0;
  const queued = counts.queued ?? 0;
  return `${run.script_name} · ${dialed}/${queued || dialed} dialed`;
}

export function ConsoleHome({ tenant }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const base = `/copilot/${encodeURIComponent(tenant)}`;

  useEffect(() => {
    fetch("/api/console/home")
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = `/copilot/login?next=${encodeURIComponent(base)}`;
          return null;
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not load home.");
        setData(body);
      })
      .catch((err) => setError(err.message));
  }, [base]);

  const healthy = data?.tenant?.whatsapp_healthy;
  const briefOn = data?.agent?.brief_enabled !== false;
  const waLink = waDeepLink(data?.tenant?.display_phone || data?.agent?.wa_id);

  return (
    <ConsoleShell tenant={tenant} title="Home">
      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {data && !data.agent?.onboarded_at ? (
        <Strip className="mb-4" tone="warn">
          <span>
            Finish setup so the morning brief and your profile land.{" "}
            <Link className="underline underline-offset-2" href={`${base}/join`}>
              Continue →
            </Link>
          </span>
        </Strip>
      ) : null}

      <Strip className="mb-6" tone={healthy && briefOn ? "live" : "warn"}>
        <span>
          WhatsApp {healthy ? "connected" : "not connected"} · Morning brief{" "}
          {briefOn ? "on" : "off"}
        </span>
      </Strip>

      {healthy ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => router.push(`${base}/runs/new`)}>New call run</Button>
          <Link className="text-sm text-ink-2 underline-offset-2 hover:underline" href={`${base}/kb`}>
            Add material to your KB
          </Link>
        </div>
      ) : (
        <Button onClick={() => router.push(`${base}/join`)}>Connect WhatsApp</Button>
      )}

      <p className="mt-3">
        <Link className="text-sm text-ink-3 underline-offset-2 hover:underline" href={`${base}/scripts`}>
          Edit your scripts →
        </Link>
      </p>

      <div className="mt-10 border-t border-rule">
        <p className="mb-2 mt-6 font-mono text-[10px] uppercase tracking-label text-ink-3">
          Recent runs
        </p>
        {data == null ? (
          <>
            <Row sub=" " title=" " />
            <Row sub=" " title=" " />
          </>
        ) : data.runs.length === 0 ? (
          <p className="py-6 text-sm text-ink-2">No runs yet. Start one when you have a list.</p>
        ) : (
          data.runs.map((run) => (
            <Row
              key={run.id}
              onClick={() => {
                window.location.href = `${base}/runs/${run.id}`;
              }}
              right={<Pill tone={run.status === "complete" ? "live" : "warn"}>{run.status}</Pill>}
              sub={
                <Link
                  className="underline-offset-2 hover:underline"
                  href={`${base}/scripts/${run.script_id}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {runSub(run)}
                </Link>
              }
              title={new Date(run.created_at).toLocaleString("en-GB", {
                timeZone: data.agent?.tz || "Asia/Dubai",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            />
          ))
        )}
      </div>

      <p className="mt-8">
        <a className="text-sm text-ink-2 underline underline-offset-2" href={waLink}>
          Open WhatsApp
        </a>
      </p>
    </ConsoleShell>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Strip } from "@/components/ui/strip";
import { Toggle } from "@/components/ui/toggle";
import { ConsoleShell } from "@/components/console/console-shell";
import { WhatsAppConnect } from "@/components/console/whatsapp-connect";
import { Tooltip } from "@/components/console/tooltip";
import { consoleBase, consoleJson } from "@/lib/console/client";
import { waDeepLink } from "@/lib/console/format";

const LEAD_SOURCES = [
  { name: "Property Finder", sub: "Portal hand-off is not wired up yet" },
  { name: "Bayut", sub: "Portal hand-off is not wired up yet" },
  { name: "Dubizzle", sub: "Portal hand-off is not wired up yet" },
  { name: "Your website form", sub: "We can post enquiries in for you" },
];

export function SettingsPage({ tenant }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [briefSending, setBriefSending] = useState(false);
  const [briefSent, setBriefSent] = useState(false);
  const [draft, setDraft] = useState(null);
  const base = consoleBase(tenant);

  const load = useCallback(async () => {
    const body = await consoleJson(base, "/api/console/settings", {
      fallback: "Could not load settings.",
    });
    setData(body);
    setDraft(null);
  }, [base]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function save(patch) {
    setSaving(true);
    setError("");
    try {
      const body = await consoleJson(base, "/api/console/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        fallback: "Could not save.",
        body: JSON.stringify(patch),
      });
      setData((current) => ({ ...current, agent: body.agent }));
      setDraft(null);
    } catch (err) {
      setError(err.message);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  // Text fields commit on blur — saving per keystroke wrote a PATCH for every
  // character, and the API takes any string as a timezone.
  function commitDraft(field) {
    const next = draft?.[field];
    if (next == null || next === (data?.agent?.[field] || "")) {
      setDraft(null);
      return;
    }
    save({ [field]: next });
  }

  async function disconnect() {
    setDisconnecting(true);
    setError("");
    try {
      await consoleJson(base, "/api/console/settings/disconnect", {
        method: "POST",
        fallback: "Disconnect failed.",
      });
      setConfirmDisconnect(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDisconnecting(false);
    }
  }

  async function sendBriefNow() {
    setBriefSending(true);
    setError("");
    try {
      await consoleJson(base, "/api/console/brief/send-now", {
        method: "POST",
        fallback: "Could not send the brief.",
      });
      setBriefSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBriefSending(false);
    }
  }

  const agent = data?.agent || {};
  const healthy = Boolean(data?.whatsapp_healthy);
  const waLink = waDeepLink(data?.number || agent.wa_id);

  return (
    <ConsoleShell tenant={tenant} waLink={waLink} width={820}>
      <h1 className="az-h1 mb-3 text-fg">Settings</h1>
      <p className="mb-12 text-lg text-dim">
        Your number, your lead sources, your morning.
      </p>

      {error ? (
        <Strip className="mb-8" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      <div className="az-eyebrow mb-4 block">WHATSAPP</div>
      <div className="az-card mb-12 flex flex-wrap items-center justify-between gap-5 px-6.5 py-6">
        <div className="flex items-center gap-3.5">
          <span
            className={`h-[9px] w-[9px] flex-none rounded-full ${healthy ? "bg-az" : "bg-warn"}`}
          />
          <div>
            <div className="text-lg font-medium text-fg">
              {data?.number || "Not connected"}
            </div>
            <div className="mt-1 text-sm text-dim">
              {healthy
                ? "Connected via Meta · one number per brokerage"
                : "Connect the brokerage number to start"}
            </div>
          </div>
        </div>
        {healthy && data?.role === "admin" && !confirmDisconnect ? (
          <button
            className="rounded-lg border border-line-2 px-4.5 py-2.5 text-sm text-dim hover:border-[#4a2a2a] hover:text-[#e08b8b]"
            onClick={() => setConfirmDisconnect(true)}
            type="button"
          >
            Disconnect
          </button>
        ) : null}
      </div>

      {confirmDisconnect ? (
        <Strip className="-mt-8 mb-12" tone="markup">
          <span>This drops the tenant WhatsApp connection. Confirm?</span>
          <span className="flex flex-wrap gap-2.5">
            <Button disabled={disconnecting} onClick={disconnect}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
            <Button onClick={() => setConfirmDisconnect(false)} variant="quiet">
              Keep it
            </Button>
          </span>
        </Strip>
      ) : null}

      {data && !healthy ? (
        <div className="mb-12">
          <WhatsAppConnect onConnected={() => load()} tenantSlug={tenant} />
        </div>
      ) : null}

      <div className="az-eyebrow mb-2.5 block">LEAD SOURCES</div>
      <p className="mb-5 max-w-[620px] text-base leading-snug text-fg-2">
        The idea: log in once and every new enquiry gets called back within 60
        seconds — while they are still looking at the listing. None of these are
        wired up yet, so nothing here will fire a call.
      </p>

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-5 rounded-xl border border-line-2 bg-panel px-5.5 py-4.5">
        <div className="flex items-center gap-2">
          <div className="text-[17px] font-medium text-fg">
            Call new enquiries within 60 seconds
          </div>
          <Tooltip>
            When this ships it will use your LIVE cold-call script inside calling
            hours only, and you get the outcome on WhatsApp either way.
          </Tooltip>
        </div>
        <Pill tone="warn">Not available yet</Pill>
      </div>

      <div className="mb-5 grid gap-2.5">
        {LEAD_SOURCES.map((item) => (
          <div
            className="az-card flex flex-wrap items-center gap-4 px-5.5 py-5"
            key={item.name}
          >
            <div className="min-w-[200px] flex-1">
              <div className="text-[17px] font-medium text-fg">{item.name}</div>
              <div className="mt-1 text-sm text-dim">{item.sub}</div>
            </div>
            <Pill>Not connected</Pill>
          </div>
        ))}
      </div>

      <div className="az-card mb-12 flex flex-wrap items-center justify-between gap-5 px-6.5 py-6">
        <div className="max-w-[440px]">
          <div className="text-lg font-semibold text-fg">
            Using a CRM we don’t list?
          </div>
          <div className="mt-1.5 text-[15px] leading-snug text-dim">
            Bitrix, Salesforce, HubSpot, something in-house — we will wire it up
            with you on a call. No developer needed on your side.
          </div>
        </div>
        <a
          className="rounded-[10px] border border-az px-5.5 py-3.5 text-base font-semibold text-fg hover:bg-az-wash"
          href={waLink}
          rel="noreferrer"
          target="_blank"
        >
          Talk to support
        </a>
      </div>

      <div className="az-eyebrow mb-4 block">YOUR MORNING</div>
      <div className="az-card mb-12 px-6.5 py-6">
        <div className="flex flex-wrap items-center justify-between gap-5 border-b border-line pb-5">
          <div>
            <div className="text-lg font-medium text-fg">Morning brief</div>
            <div className="mt-1 text-sm text-dim">
              One WhatsApp with overnight leads and who to call.
            </div>
          </div>
          <Toggle
            checked={agent.brief_enabled !== false}
            disabled={saving || !data}
            label="Morning brief"
            onChange={(checked) => save({ brief_enabled: checked })}
          />
        </div>
        <div className="grid gap-4.5 pt-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="brief">Time</Label>
            <Field
              disabled={saving || !data}
              id="brief"
              onBlur={() => commitDraft("brief_time")}
              onChange={(e) =>
                setDraft((current) => ({ ...current, brief_time: e.target.value }))
              }
              type="time"
              value={
                draft?.brief_time ??
                String(agent.brief_time || "07:30").slice(0, 5)
              }
            />
          </div>
          <div>
            <Label htmlFor="tz">Timezone</Label>
            <Field
              disabled={saving || !data}
              id="tz"
              onBlur={() => commitDraft("tz")}
              onChange={(e) =>
                setDraft((current) => ({ ...current, tz: e.target.value }))
              }
              value={draft?.tz ?? (agent.tz || "Asia/Dubai")}
            />
          </div>
        </div>
        {briefSent ? (
          <Strip className="mt-5" tone="live">
            <span>Brief sent. Open WhatsApp to read it.</span>
          </Strip>
        ) : (
          <Button
            className="mt-5"
            disabled={briefSending}
            onClick={sendBriefNow}
            variant="secondary"
          >
            {briefSending ? "Sending…" : "Send me one right now"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <Button
          onClick={() => {
            window.location.href = "/api/console/settings/export";
          }}
          variant="quiet"
        >
          Export all my data
        </Button>
        <Link
          className="az-btn-quiet"
          href={`/copilot/${encodeURIComponent(tenant)}/how-it-works`}
        >
          See the journey again
        </Link>
      </div>
    </ConsoleShell>
  );
}

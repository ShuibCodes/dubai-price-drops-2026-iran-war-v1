"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Strip } from "@/components/ui/strip";
import { Toggle } from "@/components/ui/toggle";
import { CalendarConnect } from "@/components/console/calendar-connect";
import { ConsoleShell } from "@/components/console/console-shell";
import { WhatsAppConnect } from "@/components/console/whatsapp-connect";

export function SettingsPage({ tenant }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmCalendarDisconnect, setConfirmCalendarDisconnect] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/console/settings");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not load settings.");
    setData(body);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar") === "connected") {
      setNotice("Google Calendar connected.");
    } else if (params.get("calendar") === "error") {
      setError("Google Calendar could not be connected. Try again.");
    }
    load().catch((err) => setError(err.message));
  }, []);

  async function save(patch) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/console/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save.");
      setData((current) => ({ ...current, agent: body.agent }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function disconnectCalendar() {
    setCalendarBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/console/calendar", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Calendar disconnect failed.");
      setConfirmCalendarDisconnect(false);
      setData((current) => ({ ...current, calendar: body }));
      setNotice("Google Calendar disconnected.");
    } catch (err) {
      setError(err.message);
    } finally {
      setCalendarBusy(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setError("");
    try {
      const res = await fetch("/api/console/settings/disconnect", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Disconnect failed.");
      setConfirmDisconnect(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDisconnecting(false);
    }
  }

  const agent = data?.agent || {};
  const calendar = data?.calendar || {};

  return (
    <ConsoleShell tenant={tenant} title="Settings">
      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}
      {notice ? (
        <Strip className="mb-4" tone="live">
          <span>{notice}</span>
        </Strip>
      ) : null}

      <Label>Number</Label>
      <p className="mb-6 text-sm text-ink-2">
        {data?.number || "Not connected"}
        {data?.whatsapp_healthy ? " · live" : ""}
      </p>

      {data && !data.whatsapp_healthy ? (
        <div className="mb-8">
          <WhatsAppConnect onConnected={() => load()} tenantSlug={tenant} />
        </div>
      ) : null}

      <div className="mb-6 flex items-center justify-between gap-4 border-b border-rule py-3">
        <span className="text-sm">Morning brief</span>
        <Toggle
          checked={agent.brief_enabled !== false}
          disabled={saving}
          onChange={(checked) => save({ brief_enabled: checked })}
        />
      </div>
      <div className="mb-4">
        <Label htmlFor="brief">Brief time</Label>
        <Field
          id="brief"
          onChange={(e) => save({ brief_time: e.target.value })}
          type="time"
          value={String(agent.brief_time || "07:30").slice(0, 5)}
        />
      </div>
      <div className="mb-8">
        <Label htmlFor="tz">Timezone</Label>
        <Field
          id="tz"
          onChange={(e) => save({ tz: e.target.value })}
          value={agent.tz || "Asia/Dubai"}
        />
      </div>

      <Label>Calendar</Label>
      {calendar.connected ? (
        <div className="mb-8">
          <p className="mb-2 text-sm text-ink-2">
            {calendar.label || calendar.email || "Google Calendar"}
            {calendar.email && calendar.label && calendar.label !== calendar.email
              ? ` · ${calendar.email}`
              : ""}
            {calendar.timezone ? ` · ${calendar.timezone}` : ""}
            {" · connected"}
          </p>
          {!confirmCalendarDisconnect ? (
            <Button
              onClick={() => setConfirmCalendarDisconnect(true)}
              variant="ghost"
            >
              Disconnect
            </Button>
          ) : (
            <Strip className="mt-3" tone="markup">
              <span>This drops this agent&apos;s Google Calendar. Viewings already booked stay.</span>
              <span className="flex gap-2">
                <Button disabled={calendarBusy} onClick={disconnectCalendar}>
                  {calendarBusy ? "Disconnecting…" : "Disconnect"}
                </Button>
                <Button
                  onClick={() => setConfirmCalendarDisconnect(false)}
                  variant="ghost"
                >
                  Keep it
                </Button>
              </span>
            </Strip>
          )}
        </div>
      ) : (
        <div className="mb-8">
          <p className="mb-4 text-sm text-ink-3">
            {calendar.status === "error"
              ? "This calendar needs to be reconnected."
              : "Not connected"}
          </p>
          <CalendarConnect disabled={calendar.unavailable} />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            window.location.href = "/api/console/settings/export";
          }}
          variant="secondary"
        >
          Export data
        </Button>
        {data?.role === "admin" && data?.whatsapp_healthy && !confirmDisconnect ? (
          <Button onClick={() => setConfirmDisconnect(true)} variant="ghost">
            Disconnect WhatsApp
          </Button>
        ) : null}
      </div>
      {confirmDisconnect ? (
        <Strip className="mt-4" tone="markup">
          <span>This drops the tenant WhatsApp connection. Confirm?</span>
          <span className="flex gap-2">
            <Button disabled={disconnecting} onClick={disconnect}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
            <Button onClick={() => setConfirmDisconnect(false)} variant="ghost">
              Keep it
            </Button>
          </span>
        </Strip>
      ) : null}
    </ConsoleShell>
  );
}

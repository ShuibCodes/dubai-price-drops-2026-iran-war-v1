"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { Drop } from "@/components/ui/drop";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Strip } from "@/components/ui/strip";
import { Toggle } from "@/components/ui/toggle";
import { ConsoleShell } from "@/components/console/console-shell";
import { WhatsAppConnect } from "@/components/console/whatsapp-connect";
import { waDeepLink } from "@/lib/console/format";

export function JoinWizard({ tenant }) {
  const [profile, setProfile] = useState(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(null);

  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [areas, setAreas] = useState("");
  const [ticketMin, setTicketMin] = useState("");
  const [ticketMax, setTicketMax] = useState("");
  const [languages, setLanguages] = useState("English");
  const [briefOn, setBriefOn] = useState(true);
  const [briefTime, setBriefTime] = useState("07:30");

  useEffect(() => {
    fetch("/api/console/profile")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not load profile.");
        setProfile(body);
        const agent = body.agent || {};
        setName(agent.name || "");
        setTeam(agent.team || "");
        setAreas((agent.areas || []).join(", "));
        setTicketMin(agent.ticket_min ?? "");
        setTicketMax(agent.ticket_max ?? "");
        setLanguages((agent.languages || []).join(", ") || "English");
        setBriefOn(agent.brief_enabled !== false);
        setBriefTime(String(agent.brief_time || "07:30").slice(0, 5));
        setStep(body.tenant?.whatsapp_connected ? 1 : 0);
      })
      .catch((err) => setError(err.message));
  }, []);

  const ticks = profile?.tenant?.whatsapp_connected ? [1, 2] : [0, 1, 2];
  const stepLabel =
    step === 0 ? "Connect WhatsApp" : step === 1 ? "About you" : "Morning brief";

  async function saveProfile(extra = {}) {
    const res = await fetch("/api/console/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        team,
        areas,
        languages,
        ticket_min: ticketMin,
        ticket_max: ticketMax,
        brief_enabled: briefOn,
        brief_time: briefTime,
        ...extra,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not save.");
    return body;
  }

  async function uploadFiles(files) {
    for (const file of files) {
      const form = new FormData();
      form.set("file", file);
      form.set("scope", "tenant");
      const res = await fetch("/api/console/kb", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Upload failed.");
    }
  }

  async function hideDoc(id, hide) {
    await fetch(`/api/console/kb/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hide }),
    });
    const res = await fetch("/api/console/profile");
    const body = await res.json();
    if (res.ok) setProfile(body);
  }

  async function sendBrief() {
    setSaving(true);
    setError("");
    try {
      await saveProfile({ onboarded: true });
      const res = await fetch("/api/console/brief/send-now", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not send the brief.");
      setSent(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const waLink = waDeepLink(profile?.tenant?.display_phone || profile?.agent?.wa_id);

  return (
    <ConsoleShell bare tenant={tenant} title={stepLabel}>
      <div className="mb-6 flex gap-2">
        {ticks.map((tick) => (
          <span
            className={`h-1.5 flex-1 ${tick <= step ? "bg-live" : "bg-rule-2"}`}
            key={tick}
          />
        ))}
      </div>

      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {step === 0 ? (
        <WhatsAppConnect
          onConnected={async () => {
            const res = await fetch("/api/console/profile");
            const body = await res.json();
            if (res.ok) {
              setProfile(body);
              setStep(1);
            }
          }}
          tenantSlug={tenant}
        />
      ) : null}

      {step === 1 ? (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError("");
            try {
              await saveProfile();
              setStep(2);
            } catch (err) {
              setError(err.message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <p className="text-sm leading-6 text-ink-2">
            Every field here changes what AgentZero says. Skip anything that
            does not.
          </p>
          <div>
            <Label htmlFor="name">Name</Label>
            <Field id="name" onChange={(e) => setName(e.target.value)} value={name} />
          </div>
          <div>
            <Label htmlFor="team">Team</Label>
            <Field id="team" onChange={(e) => setTeam(e.target.value)} value={team} />
          </div>
          <div>
            <Label htmlFor="areas">Areas you cover</Label>
            <Field
              id="areas"
              onChange={(e) => setAreas(e.target.value)}
              placeholder="Marina, JVC, Downtown"
              value={areas}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tmin">Typical ticket min (AED)</Label>
              <Field
                id="tmin"
                inputMode="numeric"
                onChange={(e) => setTicketMin(e.target.value)}
                value={ticketMin}
              />
            </div>
            <div>
              <Label htmlFor="tmax">Typical ticket max (AED)</Label>
              <Field
                id="tmax"
                inputMode="numeric"
                onChange={(e) => setTicketMax(e.target.value)}
                value={ticketMax}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="langs">Languages</Label>
            <Field
              id="langs"
              onChange={(e) => setLanguages(e.target.value)}
              value={languages}
            />
          </div>
          <Label>Tenant material</Label>
          <Drop accept=".pdf,.txt,.md,.csv,.png,.jpg" onFiles={(files) => uploadFiles(files).catch((err) => setError(err.message))}>
            Price lists, payment plans, brochures.
          </Drop>
          {(profile?.inherited_docs || []).map((doc) => (
            <Check
              checked={!doc.hidden}
              key={doc.id}
              onChange={(checked) => hideDoc(doc.id, !checked)}
            >
              {doc.filename} · inherited
            </Check>
          ))}
          <div className="flex gap-2 pt-2">
            <Button disabled={saving} type="submit">
              {saving ? "Saving…" : "Continue"}
            </Button>
            <Button onClick={() => setStep(2)} type="button" variant="ghost">
              Skip
            </Button>
          </div>
        </form>
      ) : null}

      {step === 2 ? (
        <div className="space-y-5">
          <p className="text-sm leading-6 text-ink-2">
            Each morning AgentZero scans the overnight pipeline, ranks who is
            worth a call, and texts you the short list. One toggle, one time.
            The first brief should arrive on your phone now — that is the
            moment this becomes real.
          </p>
          <div className="flex items-center justify-between gap-4 border-b border-rule py-3">
            <span className="text-sm">Send the morning brief</span>
            <Toggle checked={briefOn} onChange={setBriefOn} />
          </div>
          <div>
            <Label htmlFor="brief">Time ({profile?.agent?.tz || "Asia/Dubai"})</Label>
            <Field
              id="brief"
              onChange={(e) => setBriefTime(e.target.value)}
              type="time"
              value={briefTime}
            />
          </div>
          {sent ? (
            <Strip tone="live">
              <span>Brief sent. Open WhatsApp to read it.</span>
            </Strip>
          ) : (
            <Button disabled={saving} onClick={sendBrief}>
              {saving ? "Sending…" : "Send me one now →"}
            </Button>
          )}
          {sent || profile?.agent?.onboarded_at ? (
            <p>
              <a className="text-sm underline underline-offset-2" href={waLink}>
                Open WhatsApp
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </ConsoleShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { Drop } from "@/components/ui/drop";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Strip } from "@/components/ui/strip";
import { Toggle } from "@/components/ui/toggle";
import { ConsoleShell } from "@/components/console/console-shell";
import { WhatsAppConnect } from "@/components/console/whatsapp-connect";
import { Tooltip } from "@/components/console/tooltip";
import { consoleBase, consoleJson } from "@/lib/console/client";
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

  const base = consoleBase(tenant);

  useEffect(() => {
    consoleJson(base, "/api/console/profile", {
      fallback: "Could not load profile.",
    })
      .then((body) => {
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
  }, [base]);

  const connected = Boolean(profile?.tenant?.whatsapp_connected);
  const total = connected ? 2 : 3;
  const stepNo = connected ? step : step + 1;
  const stepLabel =
    step === 0 ? "SETUP" : step === 1 ? "ABOUT YOU" : "MORNING BRIEF";

  async function saveProfile(extra = {}) {
    return consoleJson(base, "/api/console/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      fallback: "Could not save.",
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
  }

  async function uploadFiles(files) {
    for (const file of files) {
      const form = new FormData();
      form.set("file", file);
      form.set("scope", "tenant");
      await consoleJson(base, "/api/console/kb", {
        method: "POST",
        body: form,
        fallback: "Upload failed.",
      });
    }
  }

  async function reloadProfile() {
    const body = await consoleJson(base, "/api/console/profile", {
      fallback: "Could not load profile.",
    });
    setProfile(body);
  }

  async function hideDoc(id, hide) {
    await consoleJson(base, `/api/console/kb/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      fallback: "Update failed.",
      body: JSON.stringify({ hide }),
    });
    await reloadProfile();
  }

  async function sendBrief() {
    setSaving(true);
    setError("");
    try {
      await saveProfile({ onboarded: true });
      setSent(
        await consoleJson(base, "/api/console/brief/send-now", {
          method: "POST",
          fallback: "Could not send the brief.",
        })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const waLink = waDeepLink(profile?.tenant?.display_phone || profile?.agent?.wa_id);

  return (
    <ConsoleShell bare footer={false} tenant={tenant} width={620}>
      <div className="az-eyebrow mb-4 block">
        STEP {stepNo} OF {total} · {stepLabel}
      </div>

      {step === 0 ? (
        <>
          <h1 className="az-h1 mb-3.5 text-fg">
            Connect your brokerage WhatsApp
          </h1>
          <p className="mb-9 text-lg leading-snug text-fg-2 [text-wrap:pretty]">
            This is the number your leads already know. AgentZero listens on it
            and texts you back. Your existing chats keep working exactly as they
            do today.
          </p>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <h1 className="az-h1 mb-3.5 text-fg">A little about you</h1>
          <p className="mb-9 text-lg leading-snug text-fg-2 [text-wrap:pretty]">
            So calls and briefs sound like you, not a call centre. Every field
            here changes what AgentZero says — skip anything that does not.
          </p>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h1 className="az-h1 mb-3.5 text-fg">Your morning brief</h1>
          <p className="mb-9 text-lg leading-snug text-fg-2 [text-wrap:pretty]">
            Each morning AgentZero scans the overnight pipeline, ranks who is
            worth a call, and texts you the short list. One toggle, one time.
          </p>
        </>
      ) : null}

      {error ? (
        <Strip className="mb-6" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {step === 0 ? (
        <div className="az-card p-6.5">
          <WhatsAppConnect
            onConnected={async () => {
              try {
                await reloadProfile();
                setStep(1);
              } catch (err) {
                setError(err.message);
              }
            }}
            tenantSlug={tenant}
          />
          <div className="mt-4.5 grid gap-2.5 text-sm leading-snug text-dim">
            <div>1 — Meta opens in a new tab. Log in as the brokerage.</div>
            <div>2 — Pick the business number. One number per brokerage.</div>
            <div>3 — You land back here. Takes about two minutes.</div>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <form
          className="grid gap-5"
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Your name</Label>
              <Field id="name" onChange={(e) => setName(e.target.value)} value={name} />
            </div>
            <div>
              <Label htmlFor="team">Team</Label>
              <Field id="team" onChange={(e) => setTeam(e.target.value)} value={team} />
            </div>
          </div>

          <div>
            <Label className="flex items-center gap-2" htmlFor="areas">
              Areas you work
              <Tooltip>
                AgentZero uses this to judge which overnight leads are actually
                worth your morning. Comma-separated is fine.
              </Tooltip>
            </Label>
            <Field
              id="areas"
              onChange={(e) => setAreas(e.target.value)}
              placeholder="Dubai Marina, JVC, Downtown"
              value={areas}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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

          <div>
            <Label>Team material</Label>
            <Drop
              accept=".pdf,.txt,.md,.csv,.png,.jpg"
              hint="Price lists, payment plans, brochures. Everyone on the team can quote from these."
              onFiles={(files) =>
                uploadFiles(files).catch((err) => setError(err.message))
              }
            >
              Drop files here
            </Drop>
          </div>

          {(profile?.inherited_docs || []).length ? (
            <div className="az-card px-5 py-1">
              {(profile?.inherited_docs || []).map((doc) => (
                <Check
                  checked={!doc.hidden}
                  key={doc.id}
                  onChange={(checked) =>
                    hideDoc(doc.id, !checked).catch((err) => setError(err.message))
                  }
                >
                  {doc.filename} · inherited
                </Check>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2.5 pt-2">
            <Button disabled={saving} type="submit">
              {saving ? "Saving…" : "Continue"}
            </Button>
            <Button onClick={() => setStep(2)} type="button" variant="quiet">
              Skip
            </Button>
          </div>
        </form>
      ) : null}

      {step === 2 ? (
        <>
          <div className="az-card px-6.5 py-6">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <div className="mb-1.5 text-[17px] font-medium text-fg">
                  One text every morning at {briefTime}
                </div>
                <div className="text-sm leading-snug text-dim">
                  Overnight leads, who is worth a call, who went quiet. On your
                  phone, before your first coffee.
                </div>
              </div>
              <Toggle checked={briefOn} label="Morning brief" onChange={setBriefOn} />
            </div>
            <div className="mt-5">
              <Label htmlFor="brief">
                Time ({profile?.agent?.tz || "Asia/Dubai"})
              </Label>
              <Field
                id="brief"
                onChange={(e) => setBriefTime(e.target.value)}
                type="time"
                value={briefTime}
              />
            </div>
            {sent ? (
              <Strip className="mt-5" tone="live">
                <span>Brief sent. Open WhatsApp to read it.</span>
              </Strip>
            ) : (
              <Button
                className="mt-5"
                disabled={saving}
                onClick={sendBrief}
                variant="secondary"
              >
                {saving ? "Sending…" : "Send me one right now"}
              </Button>
            )}
          </div>

          <div className="az-card-live mt-11 p-7">
            <div className="mb-2 text-[19px] font-semibold text-fg">
              That is the whole setup.
            </div>
            <p className="mb-5 text-[15px] leading-snug text-fg-2">
              Everything else happens in WhatsApp. Come back here only to upload
              a list, edit a script, or change a setting.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                className="rounded-[10px] bg-az px-6 py-3.5 text-base font-semibold text-az-ink hover:bg-az-hover"
                href={waLink}
                rel="noreferrer"
                target="_blank"
              >
                Open WhatsApp and say hi
              </a>
              <Link
                className="rounded-[10px] border border-line-2 px-5 py-3.5 text-base font-medium text-dim hover:text-fg"
                href={base}
              >
                Look around the console
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </ConsoleShell>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console/console-shell";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Strip } from "@/components/ui/strip";
import { consoleBase, consoleJson } from "@/lib/console/client";
import { FEEDBACK_TYPES, FEEDBACK_TYPE_LABELS } from "@/lib/feedback/constants";
import { formatWhen, statusLabel, statusTone, typeLabel } from "@/lib/feedback/display";

export function FeedbackList({ tenant }) {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("bug");
  const [file, setFile] = useState(null);
  const base = consoleBase(tenant);

  const load = useCallback(async () => {
    const body = await consoleJson(base, "/api/console/feedback", {
      fallback: "Could not load feedback.",
    });
    setTickets(body.tickets || []);
  }, [base]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await consoleJson(base, "/api/console/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        fallback: "Could not create the ticket.",
        body: JSON.stringify({ type, title, description }),
      });
      if (file && created?.ticket?.id) {
        const form = new FormData();
        form.set("file", file);
        await consoleJson(
          base,
          `/api/console/feedback/${created.ticket.id}/attachments`,
          {
            method: "POST",
            body: form,
            fallback: "Ticket saved, but the image did not upload.",
          }
        );
      }
      setTitle("");
      setDescription("");
      setType("bug");
      setFile(null);
      setNotice("Ticket sent.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConsoleShell tenant={tenant} width={880}>
      <h1 className="az-h1 mb-3 text-fg">Feedback</h1>
      <p className="mb-9 max-w-[600px] text-lg leading-snug text-fg-2 [text-wrap:pretty]">
        Tell us what is broken, what you want next, or what should work better.
        We read every ticket.
      </p>

      {error ? (
        <Strip className="mb-6" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}
      {notice ? (
        <Strip className="mb-6" tone="live">
          <span>{notice}</span>
        </Strip>
      ) : null}

      <form className="mb-12 space-y-5" onSubmit={submit}>
        <div>
          <Label htmlFor="feedback-type">Type</Label>
          <Field
            as="select"
            id="feedback-type"
            onChange={(event) => setType(event.target.value)}
            value={type}
          >
            {FEEDBACK_TYPES.map((value) => (
              <option key={value} value={value}>
                {FEEDBACK_TYPE_LABELS[value]}
              </option>
            ))}
          </Field>
        </div>
        <div>
          <Label htmlFor="feedback-title">Title</Label>
          <Field
            id="feedback-title"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Short summary"
            required
            value={title}
          />
        </div>
        <div>
          <Label htmlFor="feedback-body">Description</Label>
          <Field
            as="textarea"
            id="feedback-body"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What happened, and what did you expect?"
            required
            rows={5}
            value={description}
          />
        </div>
        <div>
          <Label htmlFor="feedback-file">Screenshot (optional)</Label>
          <input
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="az-input"
            id="feedback-file"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            type="file"
          />
          <p className="mt-2 text-[13px] text-dim">JPEG, PNG, or WebP. 5 MB max.</p>
        </div>
        <Button disabled={saving} type="submit">
          {saving ? "Sending…" : "Send ticket"}
        </Button>
      </form>

      <div className="az-eyebrow mb-3">YOUR TICKETS · {tickets?.length ?? "…"}</div>
      <div className="border-t border-line">
        {tickets == null ? (
          <>
            <div className="az-row h-[86px]" />
            <div className="az-row h-[86px]" />
          </>
        ) : tickets.length === 0 ? (
          <p className="py-8 text-[15px] text-dim">
            No tickets yet. Send one above if something needs attention.
          </p>
        ) : (
          tickets.map((ticket) => (
            <Link
              className="az-row hover:bg-panel"
              href={`${base}/feedback/${ticket.id}`}
              key={ticket.id}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-medium text-fg">
                  {ticket.title}
                </div>
                <div className="mt-1 font-mono text-[11px] tracking-[.08em] text-dim">
                  {typeLabel(ticket.type)} · {formatWhen(ticket.updated_at)}
                </div>
              </div>
              <Pill tone={statusTone(ticket.status)}>
                {statusLabel(ticket.status)}
              </Pill>
            </Link>
          ))
        )}
      </div>
    </ConsoleShell>
  );
}

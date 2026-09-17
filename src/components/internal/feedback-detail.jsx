"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Strip } from "@/components/ui/strip";
import {
  FEEDBACK_PRIORITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
} from "@/lib/feedback/constants";
import { formatWhen, statusLabel, statusTone, typeLabel } from "@/lib/feedback/display";
import { internalJson } from "@/lib/internal/client";

export function InternalFeedbackDetail({ ticketId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState("new");
  const [priority, setPriority] = useState("normal");
  const [assignedTo, setAssignedTo] = useState("");
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const body = await internalJson(`/api/internal/feedback/${ticketId}`, {
      fallback: "Could not load ticket.",
    });
    setData(body);
    setStatus(body.ticket?.status || "new");
    setPriority(body.ticket?.priority || "normal");
    setAssignedTo(body.ticket?.assigned_to || "");
  }, [ticketId]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function saveMeta(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await internalJson(`/api/internal/feedback/${ticketId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        fallback: "Could not update the ticket.",
        body: JSON.stringify({
          status,
          priority,
          assigned_to: assignedTo,
        }),
      });
      setNotice("Ticket updated.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    if (!reply.trim()) return;
    setSaving(true);
    setError("");
    try {
      await internalJson(`/api/internal/feedback/${ticketId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        fallback: "Could not send the reply.",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const ticket = data?.ticket;
  const comments = data?.comments || [];
  const attachments = data?.attachments || [];

  return (
    <main className="az-shell min-h-screen font-sans">
      <div className="border-b border-line">
        <div className="mx-auto flex max-w-[760px] items-center px-6 py-3.5">
          <Link
            className="font-mono text-[11px] tracking-[.1em] text-ghost hover:text-fg"
            href="/internal/feedback"
          >
            ← TICKETS
          </Link>
        </div>
      </div>
      <div className="mx-auto max-w-[760px] px-6 pb-28 pt-10">
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

        {ticket ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h1 className="az-h1 text-fg">{ticket.title}</h1>
              <Pill tone={statusTone(ticket.status)}>{statusLabel(ticket.status)}</Pill>
            </div>
            <p className="mb-6 font-mono text-[11px] tracking-[.08em] text-dim">
              {ticket.tenant_slug || ticket.tenant_id} · {typeLabel(ticket.type)} ·{" "}
              {formatWhen(ticket.updated_at)}
            </p>
            <p className="mb-8 whitespace-pre-wrap text-[16px] leading-relaxed text-fg-2">
              {ticket.description}
            </p>

            <form className="mb-10 grid gap-4 sm:grid-cols-3" onSubmit={saveMeta}>
              <div>
                <Label htmlFor="ticket-status">Status</Label>
                <Field
                  as="select"
                  id="ticket-status"
                  onChange={(event) => setStatus(event.target.value)}
                  value={status}
                >
                  {FEEDBACK_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {FEEDBACK_STATUS_LABELS[value]}
                    </option>
                  ))}
                </Field>
              </div>
              <div>
                <Label htmlFor="ticket-priority">Priority</Label>
                <Field
                  as="select"
                  id="ticket-priority"
                  onChange={(event) => setPriority(event.target.value)}
                  value={priority}
                >
                  {FEEDBACK_PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Field>
              </div>
              <div>
                <Label htmlFor="ticket-owner">Assignee</Label>
                <Field
                  id="ticket-owner"
                  onChange={(event) => setAssignedTo(event.target.value)}
                  placeholder="Staff name"
                  value={assignedTo}
                />
              </div>
              <div className="sm:col-span-3">
                <Button disabled={saving} type="submit" variant="white">
                  Save
                </Button>
              </div>
            </form>

            {attachments.length ? (
              <div className="mb-10">
                <div className="az-eyebrow mb-3">ATTACHMENTS</div>
                {attachments.map((file) => (
                  <a
                    className="block text-[15px] text-az hover:text-az-hover"
                    href={`/api/internal/feedback/attachments/${file.id}`}
                    key={file.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {file.filename}
                  </a>
                ))}
              </div>
            ) : null}

            <div className="az-eyebrow mb-3">THREAD</div>
            <div className="mb-8 border-t border-line">
              {comments.length === 0 ? (
                <p className="py-6 text-[15px] text-dim">No replies yet.</p>
              ) : (
                comments.map((comment) => (
                  <div className="border-b border-line py-5" key={comment.id}>
                    <div className="mb-2 font-mono text-[11px] tracking-[.08em] text-dim">
                      {comment.author_kind === "staff" ? "STAFF" : "CLIENT"} ·{" "}
                      {formatWhen(comment.created_at)}
                    </div>
                    <p className="whitespace-pre-wrap text-[15px] text-fg-2">
                      {comment.body}
                    </p>
                  </div>
                ))
              )}
            </div>

            <form className="space-y-4" onSubmit={sendReply}>
              <Label htmlFor="staff-reply">Reply to client</Label>
              <Field
                as="textarea"
                id="staff-reply"
                onChange={(event) => setReply(event.target.value)}
                rows={4}
                value={reply}
              />
              <Button disabled={saving || !reply.trim()} type="submit">
                Send reply
              </Button>
            </form>
          </>
        ) : error ? null : (
          <div className="az-row h-[120px]" />
        )}
      </div>
    </main>
  );
}

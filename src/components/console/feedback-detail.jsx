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
import { formatWhen, statusLabel, statusTone, typeLabel } from "@/lib/feedback/display";

export function FeedbackDetail({ tenant, ticketId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);
  const base = consoleBase(tenant);

  const load = useCallback(async () => {
    const body = await consoleJson(base, `/api/console/feedback/${ticketId}`, {
      fallback: "Could not load ticket.",
    });
    setData(body);
  }, [base, ticketId]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function sendReply(event) {
    event.preventDefault();
    if (saving || !reply.trim()) return;
    setSaving(true);
    setError("");
    try {
      await consoleJson(base, `/api/console/feedback/${ticketId}/comments`, {
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
    <ConsoleShell footer={false} tenant={tenant} width={760}>
      <Link className="mb-6 inline-block font-mono text-[11px] tracking-[.1em] text-ghost hover:text-fg" href={`${base}/feedback`}>
        ← FEEDBACK
      </Link>

      {error ? (
        <Strip className="mb-6" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {ticket ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="az-h1 text-fg">{ticket.title}</h1>
            <Pill tone={statusTone(ticket.status)}>{statusLabel(ticket.status)}</Pill>
          </div>
          <p className="mb-8 font-mono text-[11px] tracking-[.08em] text-dim">
            {typeLabel(ticket.type)} · {formatWhen(ticket.updated_at)}
          </p>
          <p className="mb-10 whitespace-pre-wrap text-[16px] leading-relaxed text-fg-2">
            {ticket.description}
          </p>

          {attachments.length ? (
            <div className="mb-10">
              <div className="az-eyebrow mb-3">ATTACHMENTS</div>
              <div className="space-y-2">
                {attachments.map((file) => (
                  <a
                    className="block text-[15px] text-az hover:text-az-hover"
                    href={`/api/console/feedback/attachments/${file.id}`}
                    key={file.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {file.filename}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="az-eyebrow mb-3">UPDATES</div>
          <div className="mb-8 border-t border-line">
            {comments.length === 0 ? (
              <p className="py-6 text-[15px] text-dim">No replies yet.</p>
            ) : (
              comments.map((comment) => (
                <div className="border-b border-line py-5" key={comment.id}>
                  <div className="mb-2 font-mono text-[11px] tracking-[.08em] text-dim">
                    {comment.author_kind === "staff" ? "AGENTZERO" : "YOU"} ·{" "}
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
            <Label htmlFor="feedback-reply">Reply</Label>
            <Field
              as="textarea"
              id="feedback-reply"
              onChange={(event) => setReply(event.target.value)}
              placeholder="Add an update"
              rows={4}
              value={reply}
            />
            <Button disabled={saving || !reply.trim()} type="submit">
              {saving ? "Sending…" : "Send reply"}
            </Button>
          </form>
        </>
      ) : error ? null : (
        <div className="az-row h-[120px]" />
      )}
    </ConsoleShell>
  );
}

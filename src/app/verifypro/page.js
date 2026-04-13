"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, Phone, Search, Sparkles, CheckCircle, XCircle, Mail } from "lucide-react";

const SESSION_KEY = "verifypro_session_id";

function getOrCreateSessionId() {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = `vp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `vp-${Date.now().toString(36)}`;
  }
}

export default function VerifyProPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [emailDraft, setEmailDraft] = useState(null);
  const [draftNeedsInput, setDraftNeedsInput] = useState(false);
  const [overrideRecipientEmail, setOverrideRecipientEmail] = useState("");
  const [emailSendResult, setEmailSendResult] = useState(null);
  const [health, setHealth] = useState(null);
  const sessionIdRef = useRef(null);

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
    fetch("/api/verifypro/test")
      .then((r) => r.json())
      .then((d) => setHealth(d))
      .catch(() => setHealth({ ok: false, error: "Could not reach test endpoint" }));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setEmailDraft(null);
    setDraftNeedsInput(false);
    setOverrideRecipientEmail("");
    setEmailSendResult(null);

    try {
      const isEmailIntent = /\bemail\b/i.test(trimmed);
      const endpoint = isEmailIntent ? "/api/verifypro/email-draft" : "/api/verifypro/initiate";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEmailIntent ? { message: trimmed } : { query: trimmed }),
      });

      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload?.error ?? "Something went wrong");
      }

      if (isEmailIntent) {
        if (payload?.draft) {
          setEmailDraft(payload.draft);
        }
        if (payload?.needsInput) {
          setDraftNeedsInput(true);
        }
      } else if (!payload?.success) {
        throw new Error(payload?.error ?? "Something went wrong");
      } else {
        setResult(payload);
      }
      setQuery("");
    } catch (err) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendEmail() {
    if (!emailDraft || sendingEmail) return;
    const finalTo = (overrideRecipientEmail || emailDraft.to || "").trim();
    if (!finalTo) {
      setError("Please provide recipient email before sending.");
      return;
    }

    setSendingEmail(true);
    setError(null);
    setEmailSendResult(null);
    try {
      const res = await fetch("/api/actions/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: finalTo,
          subject: emailDraft.subject,
          text: emailDraft.body,
          metadata: {
            leadName: emailDraft.leadName,
            listingArea: emailDraft.variables?.listing_area,
            transcriptSource: emailDraft.transcriptSource,
          },
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error ?? "Failed to send email");
      }
      setEmailSendResult(payload);
    } catch (err) {
      setError(err.message ?? "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">

        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#60a5fa]/25 bg-[#2563eb]/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-[#93c5fd]">
            <Sparkles className="h-3.5 w-3.5" />
            VerifyPro
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-white">
            Find a listing, call or email with AI.
          </h1>
          <p className="mt-3 text-sm leading-7 text-white/50">
            Type a listing request to call, or type something like &quot;Email Shuayb about a Marina 2 bed listing&quot; to draft a follow-up email for approval.
          </p>
        </div>

        {/* Health check */}
        {health && (
          <div className={`mb-6 rounded-[16px] border px-4 py-3 text-xs ${
            health.ok
              ? "border-[#34d399]/20 bg-[#34d399]/8 text-[#6ee7b7]"
              : "border-red-500/20 bg-red-500/8 text-red-300"
          }`}>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-block h-2 w-2 rounded-full ${health.ok ? "bg-[#34d399]" : "bg-red-400"}`} />
              <span className="font-semibold uppercase tracking-[0.16em]">
                {health.ok ? "System ready" : "Setup issue"}
              </span>
              {health.checks && Object.entries(health.checks).map(([key, val]) => (
                <span key={key} className="opacity-70">
                  {val ? "✓" : "✗"} {key}
                </span>
              ))}
              {!health.ok && health.error && <span className="opacity-80">{health.error}</span>}
            </div>
          </div>
        )}

        {/* Search form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 sm:p-5"
        >
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 2-bed apartment in JVC under 1.2M"
            disabled={loading}
            rows={3}
            className="w-full resize-none rounded-[18px] border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#2563eb]/40 disabled:opacity-50"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-white/35">
              Calls go to <span className="text-white/60">+971 58 569 0693</span> (test mode). Emails require confirmation before sending.
            </p>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-[#2563eb] px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Search className="h-4 w-4" />}
              {loading ? "Working..." : "Run"}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="mt-6 flex items-start gap-3 rounded-[20px] border border-red-500/25 bg-red-500/10 px-5 py-4">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {/* Success */}
        {result && (
          <div className="mt-6 space-y-4">
            <div className="flex items-start gap-3 rounded-[20px] border border-[#34d399]/25 bg-[#34d399]/10 px-5 py-4">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#34d399]" />
              <div>
                <p className="text-sm font-semibold text-[#6ee7b7]">Call initiated</p>
                <p className="mt-1 text-xs text-white/50">
                  AI is calling <span className="text-white/70">+971 58 569 0693</span> now
                  {result.callId && (
                    <span className="ml-2 font-mono text-white/30">· {result.callId}</span>
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-5 py-4">
              <div className="mono mb-3 text-[10px] uppercase tracking-[0.24em] text-white/35">
                Listing used
              </div>
              <div className="flex items-start gap-4">
                {result.listing.coverPhoto && (
                  <img
                    src={result.listing.coverPhoto}
                    alt={result.listing.title}
                    className="h-14 w-14 shrink-0 rounded-xl border border-white/10 object-cover"
                  />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{result.listing.title}</p>
                  <p className="mt-1 text-xs text-white/50">{result.listing.area}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.listing.price && (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em] text-white/60">
                        {result.listing.price.toLocaleString("en-AE")} AED
                      </span>
                    )}
                    {result.listing.type && (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em] text-white/60">
                        {result.listing.type}
                      </span>
                    )}
                    {result.listing.agentName && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em] text-white/60">
                        <Phone className="h-3 w-3" />
                        {result.listing.agentName}
                      </span>
                    )}
                    {result.listing.agentPhone && (
                      <span className="rounded-full border border-[#60a5fa]/20 bg-[#2563eb]/10 px-2.5 py-0.5 text-[11px] tracking-[0.12em] text-[#93c5fd]">
                        {result.listing.agentPhone}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {result.filters && (result.filters.area || result.filters.bedrooms !== null) && (
              <div className="rounded-[16px] border border-white/8 bg-white/[0.02] px-4 py-3 text-xs text-white/40">
                Parsed: {[
                  result.filters.bedrooms !== null && `${result.filters.bedrooms}BR`,
                  result.filters.propertyType,
                  result.filters.area,
                  result.filters.maxPrice && `under ${result.filters.maxPrice.toLocaleString()} AED`,
                ].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        )}

        {emailDraft && (
          <div className="mt-6 rounded-[20px] border border-[#60a5fa]/20 bg-[#2563eb]/10 p-5">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#93c5fd]" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#bfdbfe]">Draft ready</p>
                <p className="mt-1 text-xs text-white/65">Send this email?</p>
              </div>
            </div>

            <div className="mt-4 rounded-[14px] border border-white/10 bg-black/40 p-4 text-sm">
              <p className="text-white/70">
                <span className="text-white/45">To:</span>{" "}
                {overrideRecipientEmail || emailDraft.to || "Missing recipient email"}
              </p>
              <p className="mt-1 text-white/70">
                <span className="text-white/45">Subject:</span> {emailDraft.subject}
              </p>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-white/80">
                {emailDraft.body}
              </pre>
            </div>

            {draftNeedsInput && (
              <div className="mt-4">
                <label className="block text-xs uppercase tracking-[0.16em] text-white/50">
                  Recipient Email
                </label>
                <input
                  type="email"
                  value={overrideRecipientEmail}
                  onChange={(e) => setOverrideRecipientEmail(e.target.value)}
                  placeholder="lead@email.com"
                  className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#2563eb]/50"
                />
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSendEmail}
                disabled={sendingEmail}
                className="inline-flex items-center gap-2 rounded-full bg-[#2563eb] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-[#1d4ed8] disabled:opacity-50"
              >
                {sendingEmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                {sendingEmail ? "Sending..." : "Yes, send email"}
              </button>
            </div>
          </div>
        )}

        {emailSendResult && (
          <div className="mt-6 flex items-start gap-3 rounded-[20px] border border-[#34d399]/25 bg-[#34d399]/10 px-5 py-4">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#34d399]" />
            <div>
              <p className="text-sm font-semibold text-[#6ee7b7]">Email sent</p>
              <p className="mt-1 text-xs text-white/60">
                Message id: <span className="font-mono text-white/45">{emailSendResult.id ?? "n/a"}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

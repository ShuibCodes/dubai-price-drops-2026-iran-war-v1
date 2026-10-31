"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TYPEFORM_ENQUIRY_URL } from "@/lib/typeform";

function formatChargeDate(days = 5) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function GetStartedFlow({
  googleEnabled = false,
  facebookEnabled = false,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canceled = searchParams.get("canceled") === "1";

  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [offer, setOffer] = useState({
    limit: 5,
    remaining: 5,
    soldOut: false,
  });
  const [account, setAccount] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/billing/checkout", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (!live) return;
        if (body?.offer) setOffer(body.offer);
        if (body?.account) {
          setAccount(body.account);
          const status = body.account.tenant?.subscription_status;
          if (status === "trialing" || status === "active") {
            const slug = encodeURIComponent(body.account.tenantSlug);
            router.replace(
              body.account.agent?.quiz_completed_at
                ? `/copilot/${slug}`
                : `/copilot/${slug}/welcome`
            );
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [router]);

  async function startStripeCheckout() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body?.soldOut) {
          setOffer((current) => ({ ...current, remaining: 0, soldOut: true }));
        }
        throw new Error(body?.error || "Could not start checkout.");
      }
      if (body?.redirectUrl) {
        router.replace(body.redirectUrl);
        return;
      }
      if (body?.url) {
        window.location.href = body.url;
        return;
      }
      throw new Error("Stripe did not return a checkout URL.");
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  async function handleAccountSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const endpoint =
        mode === "login" ? "/api/copilot/auth" : "/api/copilot/auth/signup";
      const payload =
        mode === "login"
          ? { username: email, password }
          : { name, email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not continue.");
      }

      await startStripeCheckout();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const chargeDate = formatChargeDate(5);
  const spotsLabel =
    offer.remaining === 1
      ? "1 of 5 broker spots left"
      : `${offer.remaining} of ${offer.limit} broker spots left`;

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <Link href="/" aria-label="AgentZero home">
            <Image
              src="/brand/agentzero-lockup-horizontal.svg"
              alt="AgentZero"
              width={417}
              height={88}
              priority
              unoptimized
              className="h-6 w-auto sm:h-7"
            />
          </Link>
          <Link
            href="/copilot"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/80 transition hover:border-white/30 hover:text-white"
          >
            Log in
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:gap-12">
        <section>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#ffd60a]/40 bg-[#ffd60a]/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#ffd60a]">
            <span className="h-2 w-2 rounded-full bg-[#ffd60a]" />
            Next 5 brokers only · {spotsLabel}
          </div>

          <h1 className="mt-5 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Start your 5-day free trial.{" "}
            <span className="text-[#ffd60a]">Then AED 250/m.</span>
          </h1>

          <p className="mt-4 max-w-xl text-base leading-7 text-white/75 sm:text-lg">
            Create your account, enter your card on Stripe, and answer 3 quick
            questions so your dedicated account manager can set up your callers
            and WhatsApp.
          </p>

          <div className="mt-7 space-y-4 rounded-[28px] border border-white/10 bg-white/[0.03] p-6 sm:p-7">
            <div className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="text-sm font-semibold text-white">
                  Due today (5-day trial)
                </div>
                <div className="mt-0.5 text-xs text-white/60">
                  Card saved on Stripe · cancel from Settings anytime
                </div>
              </div>
              <div className="text-2xl font-semibold text-[#ffd60a]">AED 0</div>
            </div>

            <div className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="text-sm font-semibold text-white">
                  After 5 days ({chargeDate})
                </div>
                <div className="mt-0.5 text-xs text-white/60">
                  Only charged if you have not cancelled
                </div>
              </div>
              <div className="text-xl font-semibold text-white">
                AED 250 / month
              </div>
            </div>

            <ul className="space-y-2.5 pt-1 text-sm text-white/85">
              <li className="flex items-start gap-2.5">
                <span className="mt-1 text-[#ffd60a]">✓</span>
                <span>
                  <strong className="text-white">Dedicated account manager</strong>{" "}
                  included for the next 5 brokers
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-1 text-[#ffd60a]">✓</span>
                <span>Up to 50 AI conversations a day, Mon–Fri</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-1 text-[#ffd60a]">✓</span>
                <span>
                  15 qualified conversations in your first month, or the month
                  is free
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6 sm:rounded-[32px] sm:p-9">
          {offer.soldOut ? (
            <div>
              <div className="mono text-[11px] uppercase tracking-[0.28em] text-[#ffd60a]">
                Offer full
              </div>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                All 5 broker spots have been taken.
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/70">
                The AED 250/m rate with a dedicated account manager was capped
                at the next 5 individual brokers. Enquire below and we&apos;ll
                let you know when a spot opens.
              </p>
              <a
                href={TYPEFORM_ENQUIRY_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-[#ffd60a] px-6 py-3.5 text-sm font-semibold text-black transition hover:opacity-90"
              >
                Enquire now
              </a>
            </div>
          ) : account ? (
            <div>
              <div className="mono text-[11px] uppercase tracking-[0.28em] text-[#ffd60a]">
                Step 1 complete · Account ready
              </div>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                Continue to your 5-day free trial
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/70">
                Signed in as{" "}
                <span className="font-semibold text-white">
                  {account.agent?.email || account.agent?.name || "broker"}
                </span>
                . Next: enter your card on Stripe to start your 5 days free, then
                answer 3 quick setup questions.
              </p>

              {canceled ? (
                <p className="mt-4 rounded-2xl border border-[#ffd60a]/30 bg-[#ffd60a]/10 px-4 py-3 text-xs leading-5 text-[#ffd60a]">
                  Checkout was cancelled before your trial started. Your card
                  has not been saved.
                </p>
              ) : null}

              {error ? (
                <p className="mt-4 rounded-2xl border border-[#ff2d55]/40 bg-[#ff2d55]/10 px-4 py-3 text-sm text-[#ff9ab0]">
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                disabled={submitting}
                onClick={startStripeCheckout}
                className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-[#ff2d55] px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting
                  ? "Opening Stripe Checkout…"
                  : "Continue to 5-day free trial →"}
              </button>

              <p className="mt-3 text-center text-xs text-white/55">
                AED 0 today · AED 250/month from {chargeDate} unless you cancel
                in Settings.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="mono text-[11px] uppercase tracking-[0.28em] text-[#ffd60a]">
                  Step 1 of 2 · Account
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMode((current) =>
                      current === "signup" ? "login" : "signup"
                    );
                    setError("");
                  }}
                  className="text-xs text-white/70 underline underline-offset-4 hover:text-white"
                >
                  {mode === "signup"
                    ? "Already have an account?"
                    : "Need a new account?"}
                </button>
              </div>

              <h2 className="mt-3 text-2xl font-semibold text-white">
                {mode === "signup"
                  ? "Create your broker account"
                  : "Sign in to start your trial"}
              </h2>
              <p className="mt-1.5 text-sm text-white/65">
                Next you&apos;ll enter your card for the 5-day free trial, then
                answer 3 quick questions.
              </p>

              {googleEnabled || facebookEnabled ? (
                <div className="mt-6 space-y-3">
                  {googleEnabled ? (
                    <a
                      href="/api/copilot/auth/google?next=/get-started"
                      className="flex w-full items-center justify-center rounded-full border border-white/15 bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90"
                    >
                      Continue with Google
                    </a>
                  ) : null}
                  {facebookEnabled ? (
                    <a
                      href="/api/copilot/auth/facebook?next=/get-started"
                      className="flex w-full items-center justify-center rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                    >
                      Continue with Facebook
                    </a>
                  ) : null}
                  <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-white/40">
                    <span className="h-px flex-1 bg-white/10" />
                    or with email
                    <span className="h-px flex-1 bg-white/10" />
                  </div>
                </div>
              ) : null}

              <form onSubmit={handleAccountSubmit} className="mt-5 space-y-4">
                {mode === "signup" ? (
                  <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                    Your name
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Mercer"
                      className="mt-2 block w-full rounded-2xl border border-white/15 bg-black/60 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#ffd60a]"
                    />
                  </label>
                ) : null}

                <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                  {mode === "signup" ? "Work email" : "Email or username"}
                  <input
                    type={mode === "signup" ? "email" : "text"}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@brokerage.ae"
                    className="mt-2 block w-full rounded-2xl border border-white/15 bg-black/60 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#ffd60a]"
                  />
                </label>

                <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                  Password
                  <input
                    type="password"
                    required
                    minLength={mode === "signup" ? 8 : 1}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      mode === "signup" ? "At least 8 characters" : "Your password"
                    }
                    className="mt-2 block w-full rounded-2xl border border-white/15 bg-black/60 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#ffd60a]"
                  />
                </label>

                {error ? (
                  <p className="rounded-2xl border border-[#ff2d55]/40 bg-[#ff2d55]/10 px-4 py-3 text-sm text-[#ff9ab0]">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting || loading}
                  className="inline-flex w-full items-center justify-center rounded-full bg-[#ff2d55] px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {submitting
                    ? "Starting your 5-day trial…"
                    : "Create account & start 5-day trial →"}
                </button>

                <p className="text-center text-xs leading-5 text-white/55">
                  AED 0 today · AED 250/month after 5 days ({chargeDate}).
                  Cancel anytime from Settings.
                </p>
              </form>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

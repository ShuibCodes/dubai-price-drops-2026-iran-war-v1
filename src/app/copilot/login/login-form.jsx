"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { safeNextPath } from "@/lib/copilot/next-path";

const CALLBACK_ERRORS = {
  google_unavailable:
    "Google sign-in isn't set up yet. Use your username and password.",
  google_failed: "Google sign-in didn't complete. Try again.",
  google_unverified: "That Google account has no verified email address.",
  not_authorised:
    "That Google account isn't linked to an AgentZero agent. Ask your admin to add it.",
  link_conflict:
    "That account is already linked to a different sign-in. Ask your admin.",
};

export default function LoginForm({ googleEnabled = false }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");
  const callbackError = CALLBACK_ERRORS[searchParams.get("error")] || "";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const shownError = error || callbackError;

  const googleHref =
    requestedNext && requestedNext.startsWith("/copilot/")
      ? `/api/copilot/auth/google?next=${encodeURIComponent(requestedNext)}`
      : "/api/copilot/auth/google";

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/copilot/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || "Invalid login.");
        setLoading(false);
        return;
      }

      const next = safeNextPath(requestedNext, data.tenantSlug);
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setLoading(false);
    }
  }

  return (
    <main className="az-shell grid min-h-screen place-items-center px-6 py-10 font-sans">
      <div className="w-full max-w-[420px]">
        <div className="mb-10 font-mono text-[13px] font-bold tracking-[.18em] text-az">
          AGENTZERO
        </div>
        <h1 className="mb-2.5 text-[38px] font-semibold leading-[1.05] tracking-[-.02em] text-fg">
          Sign in
        </h1>
        <p className="mb-8 text-base leading-relaxed text-dim">
          Use the username your brokerage admin set up for you. Everything after
          this happens on WhatsApp.
        </p>

        {googleEnabled ? (
          <>
            <a
              className="mb-6 flex w-full items-center justify-center rounded-[10px] border border-line-3 py-4 text-base font-semibold text-fg transition-colors hover:border-az hover:text-az"
              href={googleHref}
            >
              Continue with Google
            </a>
            <div className="mb-6 flex items-center gap-3 font-mono text-[9.5px] uppercase tracking-[.16em] text-faint">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        ) : null}

        <form onSubmit={handleSubmit}>
          <label className="az-label uppercase" htmlFor="username">
            USERNAME
          </label>
          <input
            autoComplete="username"
            className="az-input"
            id="username"
            name="username"
            onChange={(event) => setUsername(event.target.value)}
            required
            type="text"
            value={username}
          />

          <label className="az-label mt-5 uppercase" htmlFor="password">
            PASSWORD
          </label>
          <input
            autoComplete="current-password"
            className="az-input"
            id="password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />

          {shownError ? (
            <p
              className="mt-5 rounded-[10px] border border-markup-edge bg-markup-wash px-4 py-3 text-sm text-markup"
              role="alert"
            >
              {shownError}
            </p>
          ) : null}

          <button
            className="mt-5 block w-full rounded-[10px] bg-az py-4 text-center text-base font-semibold text-az-ink transition-colors hover:bg-az-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-7 border-t border-line pt-5 text-sm leading-relaxed text-faint">
          Never used AgentZero? Your brokerage admin adds you, then you get a
          WhatsApp invite.
        </div>
      </div>
    </main>
  );
}

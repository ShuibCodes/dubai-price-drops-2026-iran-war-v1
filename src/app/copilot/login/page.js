"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function homePathForTenant(tenantSlug) {
  const slug = String(tenantSlug || "").trim();
  if (!slug) return "/copilot/login";
  return `/copilot/${encodeURIComponent(slug)}`;
}

/** Only honor ?next= when it targets the signed-in user's tenant. */
function safeNextPath(raw, tenantSlug) {
  const home = homePathForTenant(tenantSlug);
  if (typeof raw !== "string" || !raw.startsWith("/copilot/") || raw.startsWith("//")) {
    return home;
  }
  const expectedPrefix = `/copilot/${encodeURIComponent(String(tenantSlug || "").trim())}`;
  if (raw === expectedPrefix || raw.startsWith(`${expectedPrefix}/`)) {
    return raw;
  }
  return home;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

          {error ? (
            <p
              className="mt-5 rounded-[10px] border border-markup-edge bg-markup-wash px-4 py-3 text-sm text-markup"
              role="alert"
            >
              {error}
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

export default function CopilotLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="az-shell grid min-h-screen place-items-center font-sans text-dim">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

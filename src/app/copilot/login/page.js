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
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-emerald-400">
            Operations Copilot
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            One place to run your cold calls — batch campaigns across
            timezones, ask questions about any call, and keep dialing around
            the clock without sleeping or missing a beat.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
        >
          <label className="block text-sm font-medium text-slate-300">
            Username
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
              required
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-slate-300">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
              required
            />
          </label>

          {error ? (
            <p
              className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function CopilotLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

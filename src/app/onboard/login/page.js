"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import sterlingLogo from "@/app/images/sterling.jpg";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/onboard";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/onboard/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || "Sign in failed. Check your details and try again.");
        setLoading(false);
        return;
      }

      router.replace(from.startsWith("/onboard") ? from : "/onboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <Image
          src={sterlingLogo}
          alt="Sterling Boulevard"
          width={200}
          height={80}
          className="h-auto w-48 max-w-full object-contain"
          priority
        />
        <h1 className="mt-8 text-xl font-semibold text-[var(--foreground)]">
          AgentZero setup
        </h1>
        <p className="mt-2 text-sm text-[var(--foreground)]">
          Sign in with your Sterling Boulevard credentials to train AgentZero on your
          pipeline.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/80 p-6"
      >
        <label className="block text-sm font-medium text-[var(--foreground)]">
          Username
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--cyan)]/50 focus:ring-2 focus:ring-[var(--cyan)]/20"
            required
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-[var(--foreground)]">
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--cyan)]/50 focus:ring-2 focus:ring-[var(--cyan)]/20"
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
          className="mt-6 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs leading-relaxed text-[var(--foreground)]">
        Your data is used only to answer your questions. It is never shared, sold, or
        visible to anyone else.
      </p>
    </div>
  );
}

export default function OnboardLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-[var(--foreground)]">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

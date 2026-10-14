"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Strip } from "@/components/ui/strip";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/internal/feedback";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
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
        setError(data?.error || "Sign in failed.");
        setLoading(false);
        return;
      }
      const next = from.startsWith("/internal") ? from : "/internal/feedback";
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setLoading(false);
    }
  }

  return (
    <main className="az-shell flex min-h-screen items-center justify-center px-6 font-sans">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 font-mono text-[13px] font-bold tracking-[.14em] text-fg">
          AGENTZERO
        </div>
        <h1 className="az-h1 mb-3 text-fg">Staff sign in</h1>
        <p className="mb-8 text-[15px] text-dim">
          Internal feedback inbox. Same staff credentials as setup.
        </p>
        {error ? (
          <Strip className="mb-6" tone="markup">
            <span>{error}</span>
          </Strip>
        ) : null}
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="staff-user">Username</Label>
            <Field
              autoComplete="username"
              id="staff-user"
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </div>
          <div>
            <Label htmlFor="staff-pass">Password</Label>
            <Field
              autoComplete="current-password"
              id="staff-pass"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
          <Button disabled={loading} type="submit">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}

export function InternalLoginForm() {
  return (
    <Suspense
      fallback={
        <main className="az-shell flex min-h-screen items-center justify-center text-fg">
          Loading…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

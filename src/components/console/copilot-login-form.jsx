"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { copilotHomePath, safeCopilotNextPath } from "@/lib/copilot-auth-constants";

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5.4 18.6c1.2-2.6 3.6-4 6.6-4s5.4 1.4 6.6 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8 11V8.2a4 4 0 0 1 8 0V11"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEye({ off }) {
  if (off) {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="M10.5 6.2A10.8 10.8 0 0 1 12 6c5.2 0 8.8 4.2 10 6-0.5.8-1.3 1.9-2.5 3"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M6.2 6.8C4.2 8.2 2.8 10 2 12c1.2 1.8 4.8 6 10 6 1.4 0 2.7-.3 3.9-.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function CopilotLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

      const next = safeCopilotNextPath(requestedNext, data.tenantSlug);
      router.replace(next || copilotHomePath(data.tenantSlug));
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full max-w-[400px] flex-col">
      <div className="mb-9 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-hot">
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
          </span>
        </span>
        <span className="text-[17px] font-semibold tracking-tight text-[#0a0a0a]">
          Operations Copilot
        </span>
      </div>

      <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-[#0a0a0a]">
        Log in to your Account
      </h1>
      <p className="mt-2 text-[15px] text-[#8A94A6]">
        Welcome back. Sign in to continue.
      </p>

      <form onSubmit={handleSubmit} className="mt-8">
        <label className="block text-sm font-medium text-[#3D4A5C]">
          Username
          <span className="relative mt-1.5 block">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#9AA3B2]">
              <IconUser />
            </span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="Username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="block w-full rounded-[10px] border border-[#E4E9F2] bg-white py-3 pl-11 pr-3 text-sm text-[#0a0a0a] outline-none placeholder:text-[#9AA3B2] focus:border-hot focus:ring-2 focus:ring-hot/15"
              required
            />
          </span>
        </label>

        <label className="mt-4 block text-sm font-medium text-[#3D4A5C]">
          Password
          <span className="relative mt-1.5 block">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#9AA3B2]">
              <IconLock />
            </span>
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="block w-full rounded-[10px] border border-[#E4E9F2] bg-white py-3 pl-11 pr-11 text-sm text-[#0a0a0a] outline-none placeholder:text-[#9AA3B2] focus:border-hot focus:ring-2 focus:ring-hot/15"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute inset-y-0 right-2.5 flex items-center px-1.5 text-[#9AA3B2] hover:text-[#3D4A5C]"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <IconEye off={showPassword} />
            </button>
          </span>
        </label>

        {error ? (
          <p
            className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-[10px] bg-hot px-3 py-3 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}

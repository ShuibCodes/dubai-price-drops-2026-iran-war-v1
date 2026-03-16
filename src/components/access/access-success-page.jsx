"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { markLifetimeAccess, startTrialAccess } from "@/lib/access";

export default function AccessSuccessPage({ email }) {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let ignore = false;

    async function confirmAccess() {
      if (!email) {
        setStatus("missing-email");
        return;
      }

      startTrialAccess(email);

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await fetch(`/api/access?email=${encodeURIComponent(email)}`, {
          cache: "no-store",
        });
        const payload = await response.json();

        if (payload.hasLifetimeAccess) {
          markLifetimeAccess(email);

          if (!ignore) {
            setStatus("ready");
          }

          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }

      if (!ignore) {
        setStatus("pending");
      }
    }

    confirmAccess();

    return () => {
      ignore = true;
    };
  }, [email]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-xl rounded-[32px] border border-white/10 bg-white/[0.03] p-8 text-center">
        <div className="mono text-[11px] uppercase tracking-[0.32em] text-[#ffd60a]">
          Payment received
        </div>
        <h1 className="mt-4 text-3xl font-semibold">
          {status === "ready" ? "Lifetime access unlocked." : "We are confirming your access."}
        </h1>
        <p className="mt-4 text-sm leading-6 text-white/55">
          {status === "ready"
            ? "Your Stripe payment has been confirmed. You can open the dashboard now."
            : status === "pending"
              ? "Your payment was successful, but the webhook has not confirmed access yet. Wait a moment, then try again."
              : status === "missing-email"
                ? "We could not detect your email from the checkout return link."
                : "Hold on while we verify your purchase."}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/thedxpdip"
            className="rounded-full bg-[#ff2d55] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Open dashboard
          </Link>
          <Link
            href="/"
            className="rounded-full border border-white/10 px-6 py-3 text-sm text-white/75 transition hover:text-white"
          >
            Back to landing page
          </Link>
        </div>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardPage from "@/components/dashboard/dashboard-page";
import {
  getStoredAccess,
  markLifetimeAccess,
} from "@/lib/access";

function openLifetimePaymentLink() {
  const paymentLink = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK;

  if (!paymentLink) {
    throw new Error("Missing NEXT_PUBLIC_STRIPE_PAYMENT_LINK");
  }

  window.location.href = paymentLink;
}

export default function DashboardAccessGate() {
  const [state, setState] = useState({
    loading: true,
    email: null,
    hasLifetimeAccess: false,
    error: null,
  });

  useEffect(() => {
    let ignore = false;

    async function loadAccess() {
      const storedAccess = getStoredAccess();

      if (!storedAccess?.email) {
        if (!ignore) {
          setState({
            loading: false,
            email: null,
            hasLifetimeAccess: false,
            error: null,
          });
        }

        return;
      }

      try {
        const response = await fetch(
          `/api/access?email=${encodeURIComponent(storedAccess.email)}`
        );
        const payload = await response.json();
        const hasLifetime = Boolean(payload.hasLifetimeAccess);

        if (hasLifetime) {
          markLifetimeAccess(storedAccess.email);
        }

        if (!ignore) {
          setState({
            loading: false,
            email: storedAccess.email,
            hasLifetimeAccess: hasLifetime || Boolean(storedAccess.hasLifetimeAccess),
            error: null,
          });
        }
      } catch (error) {
        if (!ignore) {
          setState({
            loading: false,
            email: storedAccess.email,
            hasLifetimeAccess: Boolean(storedAccess.hasLifetimeAccess),
            error: error.message,
          });
        }
      }
    }

    loadAccess();

    return () => {
      ignore = true;
    };
  }, []);

  const hasAccess = useMemo(() => Boolean(state.email) || state.hasLifetimeAccess, [state.email, state.hasLifetimeAccess]);

  if (state.loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.03] px-8 py-10 text-center">
          Checking your access...
        </div>
      </main>
    );
  }

  if (hasAccess) {
    return <DashboardPage />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-2xl rounded-[32px] border border-white/10 bg-white/[0.03] p-8 text-center">
        <div className="mono text-[11px] uppercase tracking-[0.32em] text-[#ffd60a]">
          Access Required
        </div>
        <h1 className="mt-4 text-3xl font-semibold">
          Access details required.
        </h1>
        <p className="mt-4 text-sm leading-6 text-white/55">
          {state.email
            ? `This dashboard is tied to ${state.email}. Use the same email on the Stripe payment page to unlock lifetime access automatically.`
            : "Enter your company name and email on the landing page to continue."}
        </p>
        {state.error && (
          <p className="mt-4 text-sm text-[#ff9ab0]">{state.error}</p>
        )}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            onClick={() => openLifetimePaymentLink()}
            disabled={!state.email}
            className="rounded-full bg-[#ff2d55] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Unlock Lifetime - AED 380
          </button>
          <Link
            href="/"
            className="rounded-full border border-white/10 px-6 py-3 text-sm text-white/75 transition hover:text-white"
          >
            Back to landing page
          </Link>
        </div>
        <a
          href="https://tally.so/r/dWAJPr"
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex text-sm text-[#ffd60a]"
        >
          Need a brokerage setup instead? Enquire here.
        </a>
      </div>
    </main>
  );
}

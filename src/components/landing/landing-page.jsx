"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Hero from "@/components/dashboard/hero";
import reviewShotBrokerages from "@/app/images/IMG_0979.jpg";
import reviewShotAgents from "@/app/images/IMG_0990.jpg";
import reviewShotOffPlan from "@/app/images/IMG_0991.jpg";
import reviewShotClients from "@/app/images/IMG_0992.jpg";
import { getSalesAreaSummaries } from "@/lib/uae-sales-data";

const BASIC_FEATURES = [
  "Live price drops",
  "Pre-war averages vs post-war",
  "Map view",
];

const PRO_FEATURES = [
  "All from Basic",
  "Custom brokerage view — your logo, data and fully white-labelled",
  "Instant distress deal alerts — AI-verified before they hit your inbox",
  "AI calls up to 90 listings per day to verify availability and price flexibility",
  "One chat to rule them all — find leads from 3+ years back, auto-call, qualify and send custom listings. Seconds, not hours.",
  "3-hour hands-on AI workshop for your team",
];

const ENQUIRE_NOW_URL = "https://tally.so/r/dWAJPr";
const emptyMapState = {
  listings: [],
  loading: true,
  error: null,
};
const REVIEW_SHOTS = [
  {
    src: reviewShotBrokerages,
    alt: "WhatsApp message from dormant buyers",
    label: "Dormant buyers",
  },
  {
    src: reviewShotAgents,
    alt: "WhatsApp review from a Dubai agent",
    label: "Agents",
  },
  {
    src: reviewShotOffPlan,
    alt: "WhatsApp message from international investors",
    label: "International investors",
  },
  {
    src: reviewShotClients,
    alt: "WhatsApp review from a Dubai property professional",
    label: "",
  },
];

export default function LandingPage() {
  const [activeArea, setActiveArea] = useState(null);
  const [mapState, setMapState] = useState(emptyMapState);

  useEffect(() => {
    let ignore = false;

    async function loadLandingMap() {
      try {
        const response = await fetch("/api/sales-search?pages=1", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok || payload?.error) {
          throw new Error(payload?.error ?? "Failed to load landing map data.");
        }

        if (!ignore) {
          setMapState({
            listings: Array.isArray(payload?.listings) ? payload.listings : [],
            loading: false,
            error: null,
          });
        }
      } catch (error) {
        if (!ignore) {
          setMapState({
            listings: [],
            loading: false,
            error: error.message,
          });
        }
      }
    }

    loadLandingMap();

    return () => {
      ignore = true;
    };
  }, []);

  const areaSummaries = useMemo(
    () => getSalesAreaSummaries(mapState.listings),
    [mapState.listings]
  );

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="border-b border-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.34em] text-white/35">
              The DXB Dip
            </div>
            <div className="mt-2 text-lg font-semibold text-white">
              Market transparency by a Dubai resident.
            </div>
          </div>
          <Link
            href="/live-updates"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/75 transition hover:text-white"
          >
            Try for free
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-4xl">
          <div className="inline-flex rounded-full border border-[#ff2d55]/25 bg-[#ff2d55]/10 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-[#ff9ab0]">
            Sellers. Buyers. Agents.
          </div>
          <h1 className="mt-8 text-4xl font-semibold leading-tight sm:text-6xl">
          While others panic, you&apos;ll know <span className="underline decoration-[#f3cc0f] text-[#f3cc0f]">exactly where</span> to move.
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-8 text-white/60 sm:text-lg">
          Track live price drops, drone-hit areas, and distressed listings...cross-referenced with verified Al Jazeera updates
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/live-updates"
              className="rounded-full bg-[#ff2d55] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Try for free
            </Link>
            <a
              href={ENQUIRE_NOW_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 px-6 py-3 text-sm text-white/80 transition hover:text-white"
            >
              Enquire now
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mb-8 max-w-3xl">
          <h2 className="text-3xl font-semibold text-white">Word on the streets:</h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {REVIEW_SHOTS.map((shot) => (
            <figure
              key={shot.label}
              className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03]"
            >
              <div className="border-b border-white/8 px-5 py-4">
                {shot.label ? <div className="text-sm font-medium text-white">{shot.label}</div> : null}
              </div>
              <div className="p-3">
                <Image
                  src={shot.src}
                  alt={shot.alt}
                  className="h-auto w-full rounded-[20px]"
                  placeholder="blur"
                />
              </div>
            </figure>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
            Live map view
          </div>
          <h2 className="mt-4 text-3xl font-semibold text-white">
            Get live updates on latest drone hits, affecting panic sells/buys.
          </h2>
        </div>

        {mapState.loading ? (
          <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-8 text-sm uppercase tracking-[0.24em] text-white/45">
            Loading map intelligence...
          </div>
        ) : mapState.error ? (
          <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-8 text-sm text-[#ff9ab0]">
            {mapState.error}
          </div>
        ) : (
          <Hero
            activeArea={activeArea}
            clearActiveArea={() => setActiveArea(null)}
            onAreaSelect={setActiveArea}
            areaSummaries={areaSummaries}
          />
        )}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
            Pricing
          </div>
          <h2 className="mt-4 text-3xl font-semibold text-white">
            Simple pricing. No monthly fee.
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[32px] border border-[#ff2d55]/20 bg-[#ff2d55]/[0.06] p-7">
            <div className="text-sm uppercase tracking-[0.28em] text-[#ff9ab0]">
              Basic
            </div>
            <div className="mt-4 text-3xl font-semibold">
              AED 0
            </div>
            <div className="mt-2 text-white/65">
              Start with core market transparency.
            </div>
            <ul className="mt-6 space-y-3 text-sm text-white/75">
              {BASIC_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span className="text-[#22c55e]">✅</span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link
                href="/live-updates"
                className="inline-flex rounded-full bg-[#ff2d55] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Try for free
              </Link>
            </div>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-7">
            <div className="text-sm uppercase tracking-[0.28em] text-[#ffd60a]">
              Pro
            </div>
            <div className="mt-4 text-3xl font-semibold">
              CUSTOM
            </div>
            <div className="mt-2 text-white/65">
              No monthly fee. Yours forever.
            </div>
            <ul className="mt-6 space-y-3 text-sm text-white/75">
              {PRO_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span className="text-[#22c55e]">✅</span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <a
                href={ENQUIRE_NOW_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-full border border-white/10 px-6 py-3 text-sm text-white/80 transition hover:text-white"
              >
                Enquire now
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

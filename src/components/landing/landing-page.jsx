"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Hero from "@/components/dashboard/hero";
import { getAreaSummaries } from "@/lib/dashboard-data";

const BASIC_FEATURES = [
  "Live price drops",
  "Pre-war averages vs post-war",
  "Which areas are most likely being hit by drones",
  "Map view",
];

const PRO_FEATURES = [
  "All from Basic",
  "Custom brokerage view",
  "Your logos, data and customisable",
  "Email updates",
];

const ENQUIRE_NOW_URL = "https://tally.so/r/dWAJPr";
const MAP_PAGES = 3;
const MAP_LOCATION_IDS = "1,2,3";
const emptyMapState = {
  listings: [],
  loading: true,
  error: null,
};

export default function LandingPage() {
  const [activeArea, setActiveArea] = useState(null);
  const [mapState, setMapState] = useState(emptyMapState);

  useEffect(() => {
    let ignore = false;

    async function loadLandingMap() {
      try {
        const response = await fetch(
          `/api/dashboard?pages=${MAP_PAGES}&locationIds=${encodeURIComponent(MAP_LOCATION_IDS)}`,
          { cache: "no-store" }
        );
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

  const areaSummaries = useMemo(() => getAreaSummaries(mapState.listings), [mapState.listings]);

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
            href="/thedxpdip"
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
            The DXB Dip gives the full market picture, not filtered narratives.
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-8 text-white/60 sm:text-lg">
            Get direct transparency into live price drops, pre-war versus post-war context, and where pressure is building across Dubai. Built by someone on the ground, for people making real decisions.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/thedxpdip"
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
        <div className="mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
            Live map view
          </div>
          <h2 className="mt-4 text-3xl font-semibold text-white">
            Same map intelligence, right on the landing page.
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
                href="/thedxpdip"
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
              AED 380 lifetime access
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

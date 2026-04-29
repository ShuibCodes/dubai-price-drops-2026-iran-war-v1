"use client";

import Image from "next/image";
import reviewShotBrokerages from "@/app/images/IMG_0979.jpg";
import reviewShotAgents from "@/app/images/IMG_0990.jpg";
import reviewShotInvestors from "@/app/images/IMG_0991.jpg";

const WHATSAPP_URL = "https://wa.me/971585690693";

const REINFORCEMENT_HEADLINES = [
  "Stop losing deals your team already knows how to close.",
  "Every deal your brokerage closes makes the next one easier.",
];

const PRODUCT_STACK = [
  {
    name: "theDXBDip",
    description:
      "Real-time distressed deals matched to buyer preferences, cross-checked with verified government data.",
    ctaLabel: "View deals",
    ctaHref: "/live-updates",
  },
  {
    name: "AgentZero",
    description:
      "Auto-qualify and re-engage old leads while you sleep. AI calls, handles objections, and books meetings, with human oversight.",
  },
  {
    name: "3-Hour AI Workshop",
    description:
      "Hands-on team workshop to build internal no-code tools and drive practical adoption quickly.",
  },
];

const SOCIAL_PROOF_SHOTS = [
  {
    src: reviewShotBrokerages,
    alt: "Brokerage WhatsApp conversation screenshot",
    label: "Brokerages",
  },
  {
    src: reviewShotAgents,
    alt: "Agent WhatsApp conversation screenshot",
    label: "Agents",
  },
  {
    src: reviewShotInvestors,
    alt: "Investor WhatsApp conversation screenshot",
    label: "Investors",
  },
];

export default function AgentZeroLandingPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="border-b border-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.34em] text-white/35">
              AgentZero
            </div>
          </div>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/75 transition hover:text-white"
          >
            Book a call
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-5xl">
          <div className="inline-flex rounded-full border border-[#ff2d55]/25 bg-[#ff2d55]/10 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-[#ff9ab0]">
            Team intelligence, not guesswork
          </div>
          <h1 className="mt-8 text-4xl font-semibold leading-tight sm:text-6xl">
            Your top agent just cracked a tough objection. Does the rest of your team know how?
          </h1>
          <p className="mt-6 max-w-4xl text-base leading-8 text-white/65 sm:text-lg">
            AgentZero captures what works in real deals, objections, follow-ups, and conversions,
            then shares it instantly across your team.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-[#ff2d55] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Book a call
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">Real conversations</div>
          <h2 className="mt-4 text-3xl font-semibold text-white">Proof your team can see, not just hear</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {SOCIAL_PROOF_SHOTS.map((shot) => (
            <figure
              key={shot.label}
              className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03]"
            >
              <div className="border-b border-white/[0.08] px-5 py-4 text-sm font-medium text-white">{shot.label}</div>
              <div className="p-3">
                <Image src={shot.src} alt={shot.alt} className="h-auto w-full rounded-[20px]" placeholder="blur" />
              </div>
            </figure>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
            Product stack
          </div>
          <h2 className="mt-4 text-3xl font-semibold text-white">
            Brokerages get:
          </h2>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {PRODUCT_STACK.map((item) => (
            <article
              key={item.name}
              className="rounded-[28px] border border-white/10 bg-white/[0.03] p-7"
            >
              <div className="text-sm uppercase tracking-[0.28em] text-[#ffd60a]">✅ {item.name}</div>
              <p className="mt-5 text-sm leading-7 text-white/75">{item.description}</p>
              {item.ctaLabel && item.ctaHref ? (
                <a
                  href={item.ctaHref}
                  className="mt-5 inline-flex rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/40"
                >
                  {item.ctaLabel}
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="rounded-[32px] border border-[#ff2d55]/20 bg-[#ff2d55]/[0.06] p-7 sm:p-10">
          <div className="grid gap-3 text-base sm:text-lg">
            {REINFORCEMENT_HEADLINES.map((headline) => (
              <p key={headline} className="leading-relaxed font-semibold text-white">
                {headline}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-8 text-center sm:p-12">
          <p className="text-2xl font-semibold leading-tight text-white sm:text-4xl">
            Your best agent cannot be everywhere. AgentZero can.
          </p>
          <div className="mt-8">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-full bg-[#ff2d55] px-8 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Book a call
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

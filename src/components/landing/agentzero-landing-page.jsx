"use client";

import Image from "next/image";
import reviewShotBrokerages from "@/app/images/IMG_0979.jpg";
import reviewShotAgents from "@/app/images/IMG_0990.jpg";
import reviewShotInvestors from "@/app/images/IMG_0991.jpg";

const WHATSAPP_URL = "https://wa.me/971585690693";

const BROKERAGE_FEATURES = [
  {
    name: "Calls your leads",
    description: "AI voice that handles objections and books viewings.",
  },
  {
    name: "Never forgets",
    description: "Every lead, chat, and deal, recalled in seconds.",
  },
  {
    name: "Lives in WhatsApp",
    description: "No new app, no login, no training.",
  },
  {
    name: "Owned by you",
    description: "Your data and your edge, never someone else's training set.",
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
            For Dubai real estate brokerages
          </div>
          <h1 className="mt-8 text-4xl font-semibold leading-tight sm:text-6xl">
            A broker&apos;s brain that never sleeps
          </h1>
          <p className="mt-6 max-w-4xl text-base leading-8 text-white/65 sm:text-lg">
            Remembers every lead and conversation — and acts on it.
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
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
              How it works
            </div>
            <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
              Text it like a colleague. It does the rest.
            </h2>
            <p className="mt-5 text-base leading-8 text-white/75 sm:text-lg">
              Every brokerage&apos;s know-how is scattered — in people&apos;s heads, old
              emails, WhatsApp threads. AgentZero pulls it together and keeps it current —{" "}
              <span className="font-semibold text-[#ffd60a]">then puts it to work</span>:
              calling leads by AI voice, emailing listing packs, and following up across
              channels, all on your behalf.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-[#ff2d55] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Request access
              </a>
            </div>
          </div>
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-black">
            <iframe
              src="/agentzero-chat.html"
              title="AgentZero animated demo"
              loading="lazy"
              scrolling="no"
              sandbox="allow-scripts allow-same-origin"
              className="h-[420px] w-full lg:h-[520px]"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-black lg:order-1">
            <iframe
              src="/AgentZero-chat-2.html"
              title="AgentZero predictive lead demo"
              loading="lazy"
              scrolling="no"
              sandbox="allow-scripts allow-same-origin"
              className="h-[420px] w-full lg:h-[520px]"
            />
          </div>
          <div className="lg:order-2">
            <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
              How it works
            </div>
            <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
              Your rivals are calling the same leads. You&apos;ll call the right one first.
            </h2>
            <p className="mt-5 text-base leading-8 text-white/75 sm:text-lg">
              AgentZero reads across every chat, email and call to predict your next most
              likely close — then contacts and nurtures them for you, without you ever
              leaving WhatsApp.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-[#ff2d55] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Get access
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
            Product stack
          </div>
          <h2 className="mt-4 text-3xl font-semibold text-white">
            What brokerages get
          </h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {BROKERAGE_FEATURES.map((item) => (
            <article
              key={item.name}
              className="rounded-[28px] border border-white/10 bg-white/[0.03] p-7"
            >
              <div className="text-sm uppercase tracking-[0.28em] text-[#ffd60a]">✅ {item.name}</div>
              <p className="mt-5 text-sm leading-7 text-white/75">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="rounded-[32px] border border-[#ff2d55]/20 bg-[#ff2d55]/[0.06] p-7 sm:p-10">
          <p className="text-2xl font-semibold leading-tight text-white sm:text-3xl">
            Most AI tools are built on your data but owned by someone else. This one isn&apos;t.
          </p>
          <p className="mt-5 text-base leading-8 text-white/75 sm:text-lg">
            Every deal trains the system — so when a new agent joins, their AgentZero
            already knows your clients, your market, and how your best people close. They
            ramp in days, not months.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-8 text-center sm:p-12">
          <p className="text-2xl font-semibold leading-tight text-white sm:text-4xl">
            Your best agent can&apos;t be everywhere. AgentZero can.
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

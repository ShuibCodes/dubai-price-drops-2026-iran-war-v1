"use client";

import { animate, useInView } from "framer-motion";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import logo1416 from "@/app/images/1416-logo.png";
import logoCondCity from "@/app/images/cond-city-logo.png";
import dubaiMap from "@/app/images/dubai-map.webp";
import logoSterling from "@/app/images/sterling.jpg";

const CLIENT_LOGOS = [
  {
    src: logo1416,
    alt: "14:16",
    name: "14:16",
    className: "h-8 w-auto sm:h-10 lg:h-11",
  },
  {
    src: logoSterling,
    alt: "Sterling Boulevard",
    name: "Sterling Boulevard",
    className: "h-11 w-11 rounded-md object-cover sm:h-14 sm:w-14 lg:h-16 lg:w-16",
  },
  {
    src: logoCondCity,
    alt: "Cond City",
    name: "Cond City",
    className: "h-8 w-auto max-w-[85%] object-contain sm:h-10 lg:h-11",
  },
];

const WHATSAPP_URL = "https://wa.me/971585690693";

function CountUp({ to, duration = 2, format }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
  }, [inView, to, duration]);

  return <span ref={ref}>{format ? format(value) : Math.round(value)}</span>;
}

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

const PLAN_FEATURES = [
  "Full CRM integration (Property Finder, Bayut, and more)",
  "AI lead nurturing",
  "30 AI calls a day",
  "Native WhatsApp ... no app, no login, your agents just text a new contact",
];

function GoldCheck() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#ffd60a]"
    >
      <path
        d="M4 10.5L8 14.5L16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
        <div>
          <div className="inline-flex rounded-full border border-[#ff2d55]/25 bg-[#ff2d55]/10 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-[#ff9ab0]">
            For Dubai real estate brokerages
          </div>
          <h1 className="mt-8 text-balance text-[2rem] font-semibold leading-[1.15] tracking-tight sm:text-5xl sm:leading-[1.12] lg:text-[4.25rem] lg:leading-[1.08]">
            Either you get{" "}
            <em className="italic text-[#ff2d55]">25% more conversions</em>{" "}
            <span className="lg:block">
              in 45 days — or{" "}
              <em className="whitespace-nowrap italic">we work for free.</em>
            </span>
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
        <div className="mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
            Proven in the market
          </div>
        </div>
        <div className="mb-10 grid grid-cols-3 gap-3 sm:gap-5">
          {CLIENT_LOGOS.map((logo) => (
            <div
              key={logo.name}
              className="flex h-16 items-center justify-center rounded-2xl bg-white px-2 sm:h-20 sm:rounded-[20px] sm:px-5 lg:h-24"
            >
              <Image
                src={logo.src}
                alt={logo.alt}
                className={logo.className}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-[32px] border border-[#ff2d55]/20 bg-[#ff2d55]/[0.06] p-8 sm:p-10">
            <div className="flex flex-wrap items-baseline gap-x-2 font-semibold leading-none text-white">
              <span className="text-2xl text-white/70 sm:text-3xl">AED</span>
              <span className="text-5xl tracking-tight text-[#ff2d55] sm:text-6xl">
                <CountUp
                  to={7500000}
                  format={(v) => Math.round(v).toLocaleString()}
                />
              </span>
              <span className="text-4xl text-[#ff2d55] sm:text-5xl">+</span>
            </div>
            <p className="mt-5 text-lg leading-7 text-white/65">
              Sold with AI
            </p>
          </article>

          <article className="rounded-[32px] border border-white/10 bg-white/[0.03] p-8 sm:p-10">
            <div className="text-5xl font-semibold leading-none tracking-tight text-[#ffd60a] sm:text-6xl">
              <CountUp to={7} />
            </div>
            <p className="mt-5 text-lg leading-7 text-white/65">
              years of broker experience, built in
            </p>
          </article>
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
              Why it wins
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
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
              Compounding edge
            </div>
            <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
              Month one, it answers. Month six, it predicts.
            </h2>
            <p className="mt-5 text-base leading-8 text-white/75 sm:text-lg">
              Every chat, call and closed deal feeds one brain. AgentZero learns
              which communities are moving, what buyers actually pay there, and
              which of today&apos;s leads look like your last ten closes... then
              points your agents at them first.
            </p>
            <p className="mt-8 text-lg font-semibold text-[#ffd60a] sm:text-xl">
              6 months AI-native = 2 years ahead.
            </p>
          </div>
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-black">
            <Image
              src={dubaiMap}
              alt="AgentZero mapping which Dubai communities are moving"
              className="h-[320px] w-full object-cover object-[50%_22%] sm:h-[380px] lg:h-[440px]"
              placeholder="blur"
            />
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
        <div className="mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-[#ffd60a]">
            Pricing
          </div>
          <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
            Plans that scale with your roster
          </h2>
        </div>

        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <article className="flex flex-col rounded-[32px] border border-[#ffd60a]/40 bg-white/[0.03] p-8 transition hover:-translate-y-1 sm:p-10">
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-semibold text-white">Per Agent</h3>
              <span className="rounded-full bg-[#ffd60a] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-black">
                Most popular
              </span>
            </div>
            <div className="mt-6 flex items-baseline gap-2">
              <span className="text-5xl font-semibold leading-none text-white">
                AED 750
              </span>
            </div>
            <p className="mt-2 text-sm text-[#a1a1a1]">/ agent / month</p>

            <ul className="mt-8 space-y-4">
              {PLAN_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <GoldCheck />
                  <span className="text-sm leading-7 text-white/80">{feature}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-10">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full justify-center rounded-full bg-[#ffd60a] px-6 py-3 text-sm font-semibold text-black transition hover:opacity-90"
              >
                Get started
              </a>
            </div>
          </article>

          <article className="flex flex-col rounded-[32px] border border-[#ffd60a]/10 bg-white/[0.03] p-8 transition hover:-translate-y-1 sm:p-10">
            <h3 className="text-xl font-semibold text-white">Brokerage</h3>
            <div className="mt-6 flex items-baseline gap-2">
              <span className="text-5xl font-semibold leading-none text-white">
                Custom
              </span>
            </div>
            <p className="mt-2 text-sm text-[#a1a1a1]">tailored to your roster</p>

            <ul className="mt-8 space-y-4">
              {PLAN_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <GoldCheck />
                  <span className="text-sm leading-7 text-white/80">{feature}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-10">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full justify-center rounded-full border border-[#ffd60a]/60 px-6 py-3 text-sm font-semibold text-[#ffd60a] transition hover:bg-[#ffd60a]/10"
              >
                Request pricing
              </a>
            </div>
          </article>
        </div>

        <div className="mt-6 rounded-[20px] border-l-2 border-[#ffd60a] bg-[#ffd60a]/[0.06] px-6 py-5 text-center">
          <p className="text-base leading-7 text-white/85 sm:text-lg">
            Don&apos;t close a deal within 6 weeks?{" "}
            <span className="font-semibold text-[#ffd60a]">Pay nothing.</span>
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

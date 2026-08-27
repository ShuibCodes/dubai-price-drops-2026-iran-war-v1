"use client";

import { animate, useInView } from "framer-motion";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import logo1416 from "@/app/images/1416-logo.png";
import logoCondCity from "@/app/images/cond-city-logo.png";
import logoMeta from "@/app/images/meta-logo-new.jpeg";
import logoSterling from "@/app/images/sterling.jpg";

const CLIENT_LOGOS = [
  {
    src: logoSterling,
    alt: "Sterling Boulevard",
    name: "Sterling Boulevard",
    className: "h-10 w-10 rounded-md object-cover sm:h-12 sm:w-12",
  },
  {
    src: logo1416,
    alt: "14:16",
    name: "14:16",
    className: "h-8 w-auto max-h-10 object-contain sm:h-10",
  },
  {
    src: logoCondCity,
    alt: "Cond City",
    name: "Cond City",
    className: "h-8 w-auto max-h-10 max-w-[9.5rem] object-contain sm:h-10 sm:max-w-[11rem]",
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

const BEFORE_AFTER_ROWS = [
  {
    scenario: "An enquiry lands at 11pm",
    without: {
      headline: "9 hours later.",
      detail: "Four agents beat you to it.",
    },
    with: {
      headline: "40 seconds.",
      detail: "Called and qualified. In your WhatsApp.",
    },
  },
  {
    scenario: "200 calls a day",
    without: {
      headline: "3 hours of your day.",
      detail: "Your entire morning, on the phone.",
    },
    with: {
      headline: "Zero of your time.",
      detail: "Runs while you are in viewings.",
    },
  },
  {
    scenario: 'The lead who said "not right now"',
    without: {
      headline: "Never called again.",
      detail: "Buried in a note somewhere.",
    },
    with: {
      headline: "Followed up. Nurtured. Re-engaged.",
      detail: "Brought back when the timing is right.",
    },
  },
  {
    scenario: "Two years of old contacts",
    without: {
      headline: "Sitting on WhatsApp.",
      detail: "The gold buried in chats nobody has time to dig.",
    },
    with: {
      headline: "Found in your chats.",
      detail: "The right names surface — then get called back.",
    },
  },
  {
    scenario: "Where the conversation happens",
    without: {
      headline: "Another login.",
      detail: "A CRM nobody updates.",
    },
    with: {
      headline: "Your own number.",
      detail: "Your own WhatsApp. Nothing to log into.",
    },
  },
  {
    scenario: "Knowing who is worth calling",
    without: {
      headline: "Gut feel.",
      detail: "You call whoever you remember.",
    },
    with: {
      headline: "Ranked by what they said.",
      detail: "Budget, area and timeline, on record.",
    },
  },
];

const AGENT_PLAN_FEATURES = [
  "7–10 qualified leads a week, handed straight to you",
  "Every portal enquiry called and qualified within 60 seconds",
  "Outbound AI calling, every working day",
  "Dead WhatsApp leads revived and re-engaged",
  "No CRM, no app, no login. It all runs on your WhatsApp",
];

const BROKERAGE_PLAN_FEATURES = [
  "200 AI calls a day, across your entire roster",
  "40–55 qualified leads a week, distributed to your agents",
  "Every portal enquiry called and qualified within 60 seconds",
  "Your whole database revived, not just this month's leads",
  "Team-wide reporting: who's converting, what's stalling",
  "No CRM, no app, no login. It all runs on WhatsApp",
];

const FAQS = [
  {
    q: "Is connecting WhatsApp a privacy risk?",
    a: "AgentZero is an official Meta Tech Provider. Meta’s own team reviewed and approved our system in June 2026. Your chats go through Meta’s Cloud API — the official channel — not an unofficial WhatsApp workaround.",
  },
  {
    q: "Who is this for?",
    a: "Dubai brokerages and agents. If your leads live on WhatsApp and your day is spent dialling, this is built for you — one desk or a full roster.",
  },
  {
    q: "How do we use it?",
    a: "Connect your WhatsApp Business number. Then run it from the chat you already live in: morning briefs, “call this lead”, send a listing pack. No new app. No login. No CRM training.",
  },
  {
    q: "Does it replace my agents?",
    a: "No. It dials, qualifies, logs and follows up. Your agents get the people with budget, timeline and intent — then they close.",
  },
  {
    q: "Who owns our data?",
    a: "You do. It is not sold, not shared with other brokerages, and not used to train someone else’s model.",
  },
  {
    q: "How fast can we go live?",
    a: "A single agent can connect the same day. A brokerage rollout is a short onboarding, not a six-month CRM project.",
  },
  {
    q: "What does it cost?",
    a: "AED 750 per agent / month, or a custom plan for the whole roster. 15 qualified conversations in your first month, or that month is free.",
  },
];

function FaqList() {
  return (
    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] sm:rounded-[28px]">
      {FAQS.map((item, index) => (
        <FaqItem
          key={item.q}
          answer={item.a}
          question={item.q}
          showMeta={index === 0}
          startOpen={index === 0}
        />
      ))}
    </div>
  );
}

function FaqItem({ question, answer, startOpen = false, showMeta = false }) {
  const [open, setOpen] = useState(startOpen);

  return (
    <details
      className={`group border-b border-white/10 last:border-b-0 ${
        showMeta ? "bg-[#ff2d55]/[0.06]" : ""
      }`}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        if (nextOpen !== open) setOpen(nextOpen);
      }}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-5 sm:px-7 sm:py-6 [&::-webkit-details-marker]:hidden">
        <h3 className="text-base font-semibold leading-snug text-white sm:text-lg">
          {question}
        </h3>
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-white/25 text-white transition group-open:rotate-45 group-open:border-[#ffd60a]/40 group-open:text-[#ffd60a]"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
            <path
              d="M6 1v10M1 6h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </summary>
      <div className="px-5 pb-5 sm:px-7 sm:pb-6">
        {showMeta ? (
          <div className="mb-3 inline-flex items-center rounded-lg bg-white px-2 py-1">
            <Image alt="Meta Tech Provider" className="h-5 w-auto" src={logoMeta} />
          </div>
        ) : null}
        <p className="max-w-3xl text-sm leading-7 text-white sm:text-base sm:leading-8">
          {answer}
        </p>
      </div>
    </details>
  );
}

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
    <main className="min-h-screen bg-black font-medium text-white">
      <section className="border-b border-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.34em] text-white">
              AgentZero
            </div>
          </div>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white transition hover:text-white"
          >
            Book a call
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div>
          <div className="inline-flex max-w-full rounded-full border border-[#ff2d55]/25 bg-[#ff2d55]/10 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[#ff9ab0] sm:px-4 sm:text-[11px] sm:tracking-[0.28em]">
            For Dubai real estate brokerages
          </div>
          <h1 className="mt-6 text-balance text-[1.9rem] font-semibold leading-[1.18] tracking-tight sm:mt-8 sm:text-5xl sm:leading-[1.12] lg:text-[4.25rem] lg:leading-[1.08]">
            Nobody Got Into Real Estate To{" "}
            <em className="italic text-[#ff2d55]">Dial 200 Numbers.</em>
          </h1>
          <p className="mt-5 max-w-4xl text-base leading-7 text-white sm:mt-6 sm:text-lg sm:leading-8">
            AgentZero makes the cold calls and does the admin after them —
            qualifying, logging, following up — and hands your agents only the
            leads with budget, timeline and intent, straight to their WhatsApp.
          </p>
          <div className="mt-7 flex flex-wrap gap-3 sm:mt-8">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center rounded-full bg-[#ff2d55] px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 sm:w-auto sm:py-3"
            >
              Book a call
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="mb-6 sm:mb-8">
          <div className="text-sm font-bold uppercase tracking-[0.18em] text-white sm:text-base">
            Proven in the market
          </div>
        </div>
        <div className="mb-8 flex flex-col items-center gap-3 sm:mb-10 sm:flex-row sm:items-center sm:gap-5">
          {CLIENT_LOGOS.map((logo) => (
            <div
              key={logo.name}
              className="flex h-20 w-40 shrink-0 items-center justify-center rounded-2xl bg-white p-5 sm:h-28 sm:w-52 sm:rounded-[20px] sm:p-7"
            >
              <Image
                src={logo.src}
                alt={logo.alt}
                className={logo.className}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
          <article className="rounded-[28px] border border-[#ff2d55]/20 bg-[#ff2d55]/[0.06] p-6 sm:rounded-[32px] sm:p-10">
            <div className="flex flex-wrap items-baseline gap-x-2 font-semibold leading-none text-white">
              <span className="text-xl text-white sm:text-3xl">AED</span>
              <span className="text-4xl tracking-tight text-[#ff2d55] sm:text-6xl">
                <CountUp
                  to={30000000}
                  format={(v) => Math.round(v).toLocaleString()}
                />
              </span>
              <span className="text-3xl text-[#ff2d55] sm:text-5xl">+</span>
            </div>
            <p className="mt-4 text-base leading-7 text-white sm:mt-5 sm:text-lg">
              Sold with AI in the last 90 days
            </p>
          </article>

          <article className="rounded-[28px] border border-[#ff2d55]/20 bg-[#ff2d55]/[0.06] p-6 sm:rounded-[32px] sm:p-10">
            <p className="text-base leading-7 text-white sm:text-lg">
              Brokerages using AgentZero added
            </p>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-2 font-semibold leading-none text-white">
              <span className="text-xl text-white sm:text-3xl">AED</span>
              <span className="text-4xl tracking-tight text-[#ff2d55] sm:text-6xl">
                <CountUp
                  to={20000000}
                  format={(v) => Math.round(v).toLocaleString()}
                />
              </span>
            </div>
            <p className="mt-4 text-base leading-7 text-white sm:mt-5 sm:text-lg">
              to their pipelines within first 14 days
            </p>
          </article>

          <article className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 sm:rounded-[32px] sm:p-10">
            <div className="text-4xl font-semibold leading-none tracking-tight text-[#ffd60a] sm:text-6xl">
              7 years
            </div>
            <p className="mt-4 text-base leading-7 text-white sm:mt-5 sm:text-lg">
              of broker experience, built in
            </p>
          </article>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-10">
          <div>
            <div className="mono text-[11px] uppercase tracking-[0.32em] text-white">
              How it works
            </div>
            <h2 className="mt-4 text-[1.7rem] font-semibold leading-tight text-white sm:text-4xl">
              You close. It does everything before and after.
            </h2>
            <p className="mt-5 text-base leading-7 text-white sm:text-lg sm:leading-8">
              AgentZero learns from your own conversations, emails and call
              records —{" "}
              <span className="font-semibold text-[#ffd60a]">
                then handles the outreach
              </span>
              : AI voice calls, listing packs, follow-ups across every channel.
              Your agents direct it all from WhatsApp.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 sm:mt-8">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center rounded-full bg-[#ff2d55] px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 sm:w-auto sm:py-3"
              >
                Request access
              </a>
            </div>
          </div>
          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black sm:rounded-[28px]">
            <iframe
              src="/agentzero-chat.html"
              title="AgentZero animated demo"
              loading="lazy"
              scrolling="no"
              sandbox="allow-scripts allow-same-origin"
              className="h-[380px] w-full sm:h-[420px] lg:h-[520px]"
            />
          </div>
        </div>
        <div className="mt-10 flex flex-col items-center text-center sm:mt-14">
          <div className="flex items-center justify-center rounded-xl bg-white px-3 py-2 sm:px-4 sm:py-2.5">
            <Image
              alt="Meta Tech Provider"
              className="h-9 w-auto sm:h-10"
              src={logoMeta}
            />
          </div>
          <p className="mt-3 text-base text-white sm:text-lg">
            we&apos;re Meta verified!
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-10">
          <div className="order-2 overflow-hidden rounded-[24px] border border-white/10 bg-black sm:rounded-[28px] lg:order-1">
            <iframe
              src="/AgentZero-chat-2.html"
              title="AgentZero predictive lead demo"
              loading="lazy"
              scrolling="no"
              sandbox="allow-scripts allow-same-origin"
              className="h-[380px] w-full sm:h-[420px] lg:h-[520px]"
            />
          </div>
          <div className="order-1 lg:order-2">
            <div className="mono text-[11px] uppercase tracking-[0.32em] text-white">
              Why it wins
            </div>
            <h2 className="mt-4 text-[1.7rem] font-semibold leading-tight text-white sm:text-4xl">
              Every morning: who to call, and why.
            </h2>
            <p className="mt-5 text-base leading-7 text-white sm:text-lg sm:leading-8">
              AgentZero reads across your chats, emails and calls, spots the
              leads showing intent — a reply, a revisit, a timeline that just
              got real — and puts them at the top of your WhatsApp before your
              day starts. No new app to install.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 sm:mt-8">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center rounded-full bg-[#ff2d55] px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 sm:w-auto sm:py-3"
              >
                Get access
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="mb-8 sm:mb-10">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white">
            Before and after
          </div>
          <h2 className="mt-4 text-[1.7rem] font-semibold leading-tight text-white sm:text-4xl">
            The same working day, with and without it.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white sm:text-lg sm:leading-8">
            The work you already do, done the moment it needs doing.
          </p>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] sm:rounded-[28px]">
          <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-white/10 lg:grid">
            <div className="px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white">
              Scenario
            </div>
            <div className="border-l border-white/10 px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white">
              Without AgentZero
            </div>
            <div className="border-l border-[#ff2d55]/25 bg-[#ff2d55]/[0.06] px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ff9ab0]">
              With AgentZero
            </div>
          </div>

          {BEFORE_AFTER_ROWS.map((row, index) => (
            <div
              key={row.scenario}
              className={`grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-0 lg:p-0 ${
                index < BEFORE_AFTER_ROWS.length - 1 ? "border-b border-white/10" : ""
              }`}
            >
              <div className="lg:px-6 lg:py-6">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white lg:hidden">
                  Scenario
                </div>
                <p className="mt-1 text-base font-semibold leading-snug text-white lg:mt-0">
                  {row.scenario}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-4 lg:rounded-none lg:border-0 lg:border-l lg:border-white/10 lg:bg-transparent lg:px-6 lg:py-6">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white lg:hidden">
                  Without AgentZero
                </div>
                <p className="mt-1 text-base font-semibold text-white lg:mt-0">
                  {row.without.headline}
                </p>
                <p className="mt-1 text-sm leading-6 text-white">{row.without.detail}</p>
              </div>

              <div className="rounded-2xl border border-[#ff2d55]/25 bg-[#ff2d55]/[0.08] p-4 lg:rounded-none lg:border-0 lg:border-l lg:border-[#ff2d55]/25 lg:bg-[#ff2d55]/[0.06] lg:px-6 lg:py-6">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ff9ab0] lg:hidden">
                  With AgentZero
                </div>
                <p className="mt-1 text-base font-semibold text-[#ffd60a] lg:mt-0">
                  {row.with.headline}
                </p>
                <p className="mt-1 text-sm leading-6 text-white">{row.with.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3 sm:mt-10">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center rounded-full bg-[#ff2d55] px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 sm:w-auto sm:py-3"
          >
            Book a call
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="mb-6 sm:mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white">
            Product stack
          </div>
          <h2 className="mt-4 text-[1.7rem] font-semibold text-white sm:text-3xl">
            What brokerages get
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
          {BROKERAGE_FEATURES.map((item) => (
            <article
              key={item.name}
              className="rounded-[24px] border border-white/10 bg-white/[0.03] p-6 sm:rounded-[28px] sm:p-7"
            >
              <div className="text-xs uppercase tracking-[0.22em] text-[#ffd60a] sm:text-sm sm:tracking-[0.28em]">
                ✅ {item.name}
              </div>
              <p className="mt-4 text-sm leading-7 text-white sm:mt-5">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="rounded-[28px] border border-[#ff2d55]/20 bg-[#ff2d55]/[0.06] p-6 sm:rounded-[32px] sm:p-10">
          <p className="text-xl font-semibold leading-tight text-white sm:text-3xl">
            Most AI tools are built on your data but owned by someone else. This one isn&apos;t.
          </p>
          <p className="mt-4 text-base leading-7 text-white sm:mt-5 sm:text-lg sm:leading-8">
            Every deal trains the system — so when a new agent joins, their AgentZero
            already knows your clients, your market, and how your best people close. They
            ramp in days, not months.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="mb-6 sm:mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-[#ffd60a]">
            Pricing
          </div>
          <h2 className="mt-4 text-[1.7rem] font-semibold leading-tight text-white sm:text-4xl">
            Plans that scale with your roster
          </h2>
        </div>

        <div className="grid items-stretch gap-4 sm:gap-6 lg:grid-cols-2">
          <article className="flex flex-col rounded-[28px] border border-[#ffd60a]/40 bg-white/[0.03] p-6 transition hover:-translate-y-1 sm:rounded-[32px] sm:p-10">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-semibold text-white">Per Agent</h3>
              <span className="rounded-full bg-[#ffd60a] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-black">
                Most popular
              </span>
            </div>
            <div className="mt-5 flex items-baseline gap-2 sm:mt-6">
              <span className="text-4xl font-semibold leading-none text-white sm:text-5xl">
                AED 750
              </span>
            </div>
            <p className="mt-2 text-sm text-white">/ agent / month</p>

            <ul className="mt-7 space-y-4 sm:mt-8">
              {AGENT_PLAN_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <GoldCheck />
                  <span className="text-sm leading-7 text-white">{feature}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-8 sm:pt-10">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full justify-center rounded-full bg-[#ffd60a] px-6 py-3.5 text-sm font-semibold text-black transition hover:opacity-90 sm:py-3"
              >
                Get started
              </a>
            </div>
          </article>

          <article className="flex flex-col rounded-[28px] border border-[#ffd60a]/10 bg-white/[0.03] p-6 transition hover:-translate-y-1 sm:rounded-[32px] sm:p-10">
            <h3 className="text-xl font-semibold text-white">Brokerage</h3>
            <div className="mt-5 flex items-baseline gap-2 sm:mt-6">
              <span className="text-4xl font-semibold leading-none text-white sm:text-5xl">
                Custom
              </span>
            </div>
            <p className="mt-2 text-sm text-white">tailored to your roster</p>

            <ul className="mt-7 space-y-4 sm:mt-8">
              {BROKERAGE_PLAN_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <GoldCheck />
                  <span className="text-sm leading-7 text-white">{feature}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-8 sm:pt-10">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full justify-center rounded-full border border-[#ffd60a]/60 px-6 py-3.5 text-sm font-semibold text-[#ffd60a] transition hover:bg-[#ffd60a]/10 sm:py-3"
              >
                Request pricing
              </a>
            </div>
          </article>
        </div>

        <div className="mt-5 rounded-[20px] border-l-2 border-[#ffd60a] bg-[#ffd60a]/[0.06] px-5 py-4 text-center sm:mt-6 sm:px-6 sm:py-5">
          <p className="text-base leading-7 text-white sm:text-lg">
            15 qualified conversations in your first month, or the month is free.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="mb-6 sm:mb-8">
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white">
            FAQ
          </div>
          <h2 className="mt-4 text-[1.7rem] font-semibold leading-tight text-white sm:text-4xl">
            Straight answers, before you book a call.
          </h2>
        </div>

        <FaqList />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-7 text-center sm:rounded-[32px] sm:p-12">
          <p className="text-xl font-semibold leading-tight text-white sm:text-4xl">
            Your best agent can&apos;t be everywhere. AgentZero can.
          </p>
          <div className="mt-7 sm:mt-8">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center rounded-full bg-[#ff2d55] px-8 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 sm:w-auto sm:py-3"
            >
              Book a call
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

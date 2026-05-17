"use client";

import { useState } from "react";
import { Sheet } from "lucide-react";
import KbUploader from "@/components/onboard/UploadProgress";

const TRUST_LINE =
  "Your data is used only to answer your questions. It is never shared, sold, or visible to anyone else.";

const SCREEN2_HEADERS = {
  whatsapp: {
    title: "Your conversations stay private.",
    body: "Only you can see what you upload. AgentZero uses your chats to answer your questions — nothing is shared with your brokerage or anyone else.",
  },
  crm: {
    title: "Start with your pipeline.",
    body: "Upload a simple CSV with your leads. AgentZero will know who to call, when to follow up, and what each lead is looking for.",
  },
};

export default function OnboardPage() {
  const [step, setStep] = useState("pick");

  if (step === "pick") {
    return (
      <PickScreen
        onSelectWhatsApp={() => setStep("whatsapp")}
        onSelectCrm={() => setStep("crm")}
      />
    );
  }

  const header = SCREEN2_HEADERS[step];

  return (
    <UploadScreen
      header={header}
      type={step}
      onBack={() => setStep("pick")}
      onAddMoreData={() => setStep("pick")}
    />
  );
}

function StepIndicator({ current, total = 2 }) {
  return (
    <div className="mb-8 flex flex-col items-center gap-3 sm:items-start">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
        Step {current} of {total}
      </p>
      <div className="flex gap-2" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 w-10 rounded-full transition-colors ${
              i + 1 === current ? "bg-[var(--foreground)]" : "bg-white/20"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function WhatsAppIcon({ className = "h-7 w-7" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function PickScreen({ onSelectWhatsApp, onSelectCrm }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <StepIndicator current={1} />

      <header className="mb-10 text-center sm:text-left">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
          How much should AgentZero know?
        </h1>
      </header>

      <div className="grid gap-5 sm:grid-cols-2">
        <ChoiceCard
          variant="whatsapp"
          icon={
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#25D366]/15">
              <WhatsAppIcon className="h-7 w-7 text-[#25D366]" />
            </span>
          }
          title="Full Memory Mode"
          description="AgentZero learns from your actual conversations. It knows the context, the tone, the details your CRM never captures."
          cta="Start Full Memory"
          bestFor="Best for: agents who want a real second brain"
          onClick={onSelectWhatsApp}
        />
        <ChoiceCard
          variant="crm"
          icon={
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--cyan)]/15 text-[var(--cyan)]">
              <Sheet className="h-6 w-6" strokeWidth={1.75} />
            </span>
          }
          title="Quick Start"
          description="A CRM sync or leads export — names, numbers, deal stages. AgentZero stays useful without needing access to your conversations."
          cta="Quick Start"
          bestFor="Best for: agents who want to start light"
          onClick={onSelectCrm}
        />
      </div>

      <p className="mt-8 text-center text-[13px] font-semibold leading-relaxed text-[var(--foreground)] sm:text-[15px]">
        <span aria-hidden="true">*</span> {TRUST_LINE}
      </p>
    </div>
  );
}

function UploadScreen({ header, type, onBack, onAddMoreData }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <StepIndicator current={2} />

      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm text-[var(--foreground)]/80 transition hover:text-[var(--foreground)]"
      >
        ← Back
      </button>
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">
          {header.title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--foreground)]/90">{header.body}</p>
      </header>
      <KbUploader type={type} onBack={onBack} onAddMoreData={onAddMoreData} />
    </div>
  );
}

const CARD_VARIANTS = {
  whatsapp: {
    card: "border-[#25D366]/35 bg-[#25D366]/[0.06] hover:border-[#25D366]/55 hover:bg-[#25D366]/[0.1]",
    button: "bg-[#25D366] text-white hover:bg-[#20bd5a]",
  },
  crm: {
    card: "border-white/25 bg-white/[0.06] hover:border-white/40 hover:bg-white/[0.09]",
    button: "bg-white text-[#0a0a0a] hover:bg-neutral-100",
  },
};

function ChoiceCard({ variant, icon, title, description, cta, bestFor, onClick }) {
  const styles = CARD_VARIANTS[variant] ?? CARD_VARIANTS.crm;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex h-full flex-col rounded-2xl border p-6 text-left shadow-lg shadow-black/20 transition ${styles.card}`}
    >
      <div className="mb-4">{icon}
      </div>
      <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--foreground)]/85">
        {description}
      </p>
      <span
        className={`mt-6 block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition ${styles.button}`}
      >
        {cta}
      </span>
      <span className="mt-2 block text-center text-xs text-[var(--muted)]">{bestFor}</span>
    </button>
  );
}

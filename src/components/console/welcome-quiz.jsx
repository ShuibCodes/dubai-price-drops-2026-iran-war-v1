"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console/console-shell";
import { Strip } from "@/components/ui/strip";
import { consoleBase, consoleJson } from "@/lib/console/client";

const LEAD_SOURCE_OPTIONS = [
  "Property Finder",
  "Bayut",
  "dubizzle",
  "Meta ads",
  "Cold lists",
];

const LEAD_VOLUME_OPTIONS = [
  { value: "Under 20", sub: "Building the pipeline" },
  { value: "20–50", sub: "Steady weekly flow" },
  { value: "50–150", sub: "High-volume desk" },
  { value: "150+", sub: "More enquiries than one person can call" },
];

const CALLBACK_SPEED_OPTIONS = [
  { value: "Within 5 minutes", sub: "While they are still on the portal" },
  { value: "Within the hour", sub: "Between viewings and meetings" },
  { value: "Same day", sub: "Once the afternoon clears" },
  { value: "Next day or when I can", sub: "A lot of them go cold first" },
];

const TOTAL_STEPS = 4;

const slideVariants = {
  enter: (direction) => ({
    x: direction >= 0 ? 48 : -48,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: direction >= 0 ? -48 : 48,
    opacity: 0,
  }),
};

export function WelcomeQuiz({ tenant }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const base = consoleBase(tenant);

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [leadSources, setLeadSources] = useState([]);
  const [monthlyVolume, setMonthlyVolume] = useState("");
  const [callbackSpeed, setCallbackSpeed] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [trialEndsAt, setTrialEndsAt] = useState(null);

  useEffect(() => {
    let live = true;

    async function load() {
      try {
        if (sessionId) {
          await fetch(
            `/api/billing/checkout?session_id=${encodeURIComponent(sessionId)}`,
            { cache: "no-store" }
          ).catch(() => {});
        }

        const body = await consoleJson(base, "/api/console/profile", {
          fallback: "Could not load your profile.",
        });
        if (!live) return;

        const agent = body?.agent || {};
        const sources = Array.isArray(agent.lead_sources) ? agent.lead_sources : [];
        const volume = agent.monthly_lead_volume || "";
        const speed = agent.callback_speed || "";
        const phone = agent.wa_id ? `+${String(agent.wa_id).replace(/^\+/, "")}` : "+971 ";

        setLeadSources(sources);
        setMonthlyVolume(volume);
        setCallbackSpeed(speed);
        setWaNumber(phone);
        setTrialEndsAt(body?.tenant?.trial_ends_at || null);

        if (!sources.length) {
          setStep(0);
        } else if (!volume) {
          setStep(1);
        } else if (!speed) {
          setStep(2);
        } else {
          setStep(3);
        }
      } catch (err) {
        if (live) setError(err.message);
      } finally {
        if (live) setLoading(false);
      }
    }

    load();
    return () => {
      live = false;
    };
  }, [base, sessionId]);

  async function savePatch(patch) {
    return consoleJson(base, "/api/console/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      fallback: "Could not save your answer.",
      body: JSON.stringify(patch),
    });
  }

  function goTo(nextStep) {
    setError("");
    setDirection(nextStep > step ? 1 : -1);
    setStep(nextStep);
  }

  function toggleSource(source) {
    setLeadSources((current) =>
      current.includes(source)
        ? current.filter((item) => item !== source)
        : [...current, source]
    );
  }

  async function continueFromSources() {
    if (!leadSources.length) {
      setError("Pick at least one lead source to continue.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await savePatch({ lead_sources: leadSources });
      goTo(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function selectVolume(value) {
    setMonthlyVolume(value);
    setSaving(true);
    setError("");
    try {
      await savePatch({ monthly_lead_volume: value });
      goTo(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function selectSpeed(value) {
    setCallbackSpeed(value);
    setSaving(true);
    setError("");
    try {
      await savePatch({ callback_speed: value });
      goTo(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function finishQuiz(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await savePatch({
        lead_sources: leadSources,
        monthly_lead_volume: monthlyVolume,
        callback_speed: callbackSpeed,
        wa_id: waNumber,
        quiz_completed: true,
        onboarded: true,
      });
      router.push(base);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const formattedTrialEnd = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null;

  return (
    <ConsoleShell bare footer={false} tenant={tenant} width={620}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="az-eyebrow">
          5-DAY FREE TRIAL ACTIVE · QUESTION {step + 1} OF {TOTAL_STEPS}
        </div>
        {formattedTrialEnd ? (
          <span className="font-mono text-xs text-az">
            AED 0 until {formattedTrialEnd} · then AED 250/m
          </span>
        ) : (
          <span className="font-mono text-xs text-az">
            5 days free · then AED 250/m
          </span>
        )}
      </div>

      <div className="mb-8 h-1.5 w-full overflow-hidden rounded-full bg-[#1a201e]">
        <div
          className="h-full bg-az transition-all duration-300"
          style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
        />
      </div>

      {error ? (
        <Strip className="mb-6" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {loading ? (
        <div className="az-card p-7 text-sm text-dim">
          Starting your 5-day trial…
        </div>
      ) : (
        <div className="relative overflow-hidden">
          <AnimatePresence custom={direction} mode="wait">
            {step === 0 ? (
              <motion.section
                key="q-sources"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="az-card p-6 sm:p-8"
              >
                <h1 className="az-h1 text-fg">
                  Where do your leads come from?
                </h1>
                <p className="mt-2 text-base text-dim">
                  Pick every channel you work. Your dedicated account manager
                  will tune your callers around these.
                </p>

                <div className="mt-6 grid gap-3">
                  {LEAD_SOURCE_OPTIONS.map((option) => {
                    const selected = leadSources.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleSource(option)}
                        className={`flex w-full items-center justify-between rounded-xl border px-5 py-4 text-left text-base font-medium transition ${
                          selected
                            ? "border-az bg-az-wash text-fg shadow-[0_0_0_2px_rgba(53,224,139,0.18)]"
                            : "border-line-2 bg-[#101413] text-fg-2 hover:border-line-3 hover:text-fg"
                        }`}
                      >
                        <span>{option}</span>
                        <span
                          className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                            selected
                              ? "bg-az text-az-ink"
                              : "border border-line-3 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-7 flex items-center justify-end">
                  <button
                    type="button"
                    disabled={saving || !leadSources.length}
                    onClick={continueFromSources}
                    className="rounded-[10px] bg-az px-6 py-3.5 text-sm font-semibold text-az-ink transition hover:bg-az-hover disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Continue →"}
                  </button>
                </div>
              </motion.section>
            ) : null}

            {step === 1 ? (
              <motion.section
                key="q-volume"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="az-card p-6 sm:p-8"
              >
                <h1 className="az-h1 text-fg">
                  Roughly how many new leads a month?
                </h1>
                <p className="mt-2 text-base text-dim">
                  One tap moves you to the next question.
                </p>

                <div className="mt-6 grid gap-3">
                  {LEAD_VOLUME_OPTIONS.map((option) => {
                    const selected = monthlyVolume === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={saving}
                        onClick={() => selectVolume(option.value)}
                        className={`flex w-full items-center justify-between rounded-xl border px-5 py-4 text-left transition ${
                          selected
                            ? "border-az bg-az-wash text-fg"
                            : "border-line-2 bg-[#101413] text-fg hover:border-az"
                        }`}
                      >
                        <div>
                          <div className="text-base font-semibold">
                            {option.value}
                          </div>
                          <div className="mt-0.5 text-sm text-dim">
                            {option.sub}
                          </div>
                        </div>
                        <span className="text-lg text-az">→</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => goTo(0)}
                    className="text-xs font-mono uppercase tracking-[0.14em] text-dim hover:text-fg"
                  >
                    ← Back
                  </button>
                </div>
              </motion.section>
            ) : null}

            {step === 2 ? (
              <motion.section
                key="q-speed"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="az-card p-6 sm:p-8"
              >
                <h1 className="az-h1 text-fg">
                  How quickly do you usually call a new lead back?
                </h1>
                <p className="mt-2 text-base text-dim">
                  AgentZero calls new enquiries in under 60 seconds, day or
                  night.
                </p>

                <div className="mt-6 grid gap-3">
                  {CALLBACK_SPEED_OPTIONS.map((option) => {
                    const selected = callbackSpeed === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={saving}
                        onClick={() => selectSpeed(option.value)}
                        className={`flex w-full items-center justify-between rounded-xl border px-5 py-4 text-left transition ${
                          selected
                            ? "border-az bg-az-wash text-fg"
                            : "border-line-2 bg-[#101413] text-fg hover:border-az"
                        }`}
                      >
                        <div>
                          <div className="text-base font-semibold">
                            {option.value}
                          </div>
                          <div className="mt-0.5 text-sm text-dim">
                            {option.sub}
                          </div>
                        </div>
                        <span className="text-lg text-az">→</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => goTo(1)}
                    className="text-xs font-mono uppercase tracking-[0.14em] text-dim hover:text-fg"
                  >
                    ← Back
                  </button>
                </div>
              </motion.section>
            ) : null}

            {step === 3 ? (
              <motion.form
                key="q-whatsapp"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.28, ease: "easeOut" }}
                onSubmit={finishQuiz}
                className="az-card p-6 sm:p-8"
              >
                <h1 className="az-h1 text-fg">What&apos;s your WhatsApp number?</h1>
                <p className="mt-2 text-base text-dim">
                  This is where AgentZero sends qualified leads, call summaries,
                  and your 7am shortlist — and where your dedicated account
                  manager will reach you.
                </p>

                <div className="mt-6">
                  <label
                    htmlFor="wa-number"
                    className="block font-mono text-xs uppercase tracking-[0.14em] text-dim"
                  >
                    WhatsApp number
                  </label>
                  <input
                    id="wa-number"
                    type="tel"
                    required
                    autoFocus
                    value={waNumber}
                    onChange={(e) => setWaNumber(e.target.value)}
                    placeholder="+971 50 123 4567"
                    className="mt-2 block w-full rounded-xl border border-line-3 bg-[#101413] px-4 py-3.5 text-lg text-fg outline-none focus:border-az"
                  />
                </div>

                <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => goTo(2)}
                    className="text-xs font-mono uppercase tracking-[0.14em] text-dim hover:text-fg"
                  >
                    ← Back
                  </button>

                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-[10px] bg-az px-6 py-3.5 text-sm font-semibold text-az-ink transition hover:bg-az-hover disabled:opacity-40"
                  >
                    {saving ? "Opening your workspace…" : "Finish & open AgentZero →"}
                  </button>
                </div>
              </motion.form>
            ) : null}
          </AnimatePresence>
        </div>
      )}
    </ConsoleShell>
  );
}

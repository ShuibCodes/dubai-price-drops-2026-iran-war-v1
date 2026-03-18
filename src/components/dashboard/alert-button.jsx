"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const COUNTRY_CODES = [
  { code: "+971", flag: "🇦🇪", label: "UAE" },
  { code: "+966", flag: "🇸🇦", label: "KSA" },
  { code: "+974", flag: "🇶🇦", label: "QAT" },
  { code: "+44",  flag: "🇬🇧", label: "UK" },
  { code: "+1",   flag: "🇺🇸", label: "US" },
  { code: "+91",  flag: "🇮🇳", label: "IND" },
  { code: "+7",   flag: "🇷🇺", label: "RUS" },
];

const BUDGET_OPTIONS = [
  "Budget Range",
  "Under AED 50K / yr",
  "AED 50K–100K / yr",
  "AED 100K–200K / yr",
  "AED 200K–500K / yr",
  "AED 500K+ / yr",
];

const CITY_OPTIONS = [
  "Any City",
  "Dubai Marina",
  "Downtown Dubai",
  "Palm Jumeirah",
  "Business Bay",
  "JVC",
  "Al Barsha",
  "Jumeirah",
  "Arabian Ranches",
];

export default function AlertButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+971");
  const [whatsapp, setWhatsapp] = useState("");
  const [area, setArea] = useState("");
  const [budget, setBudget] = useState("Budget Range");
  const [city, setCity] = useState("Any City");
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState("");

  function openModal() {
    setIsOpen(true);
    setStatus("idle");
    setErrorMsg("");
  }

  function closeModal() {
    if (status === "loading") return;
    setIsOpen(false);
    setTimeout(() => {
      setName("");
      setEmail("");
      setWhatsapp("");
      setArea("");
      setBudget("Budget Range");
      setCity("Any City");
      setCountryCode("+971");
      setStatus("idle");
      setErrorMsg("");
    }, 300);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          whatsapp: `${countryCode}${whatsapp}`,
          area,
          budget,
          city,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Something went wrong");
      }

      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.message ?? "Failed to subscribe. Please try again.");
    }
  }

  return (
    <>
      {/* Floating button */}
      <motion.button
        onClick={openModal}
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.8 }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.96 }}
        className="fixed bottom-6 right-5 z-50 flex items-center gap-2 rounded-full border border-white/15 bg-[#ff2d55] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_32px_rgba(255,45,85,0.45)] transition-shadow hover:shadow-[0_12px_40px_rgba(255,45,85,0.6)] sm:bottom-8 sm:right-8 sm:px-5 sm:py-3.5 sm:text-base"
      >
        <span className="text-base leading-none sm:text-lg">🔔</span>
        <span>Get Alerts</span>
      </motion.button>

      {/* Modal backdrop + popup */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            />

            {/* Modal positioning wrapper */}
            <div
              className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
              onClick={closeModal}
            >
            {/* Modal */}
            <motion.div
              key="modal"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-md rounded-t-[28px] border border-white/10 bg-[#0d0d0f] p-6 shadow-[0_-20px_80px_rgba(0,0,0,0.8)] sm:rounded-[28px] sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={closeModal}
                disabled={status === "loading"}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80 disabled:opacity-40"
                aria-label="Close"
              >
                ✕
              </button>

              {status === "success" ? (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <div className="text-5xl">✅</div>
                  <div>
                    <p className="text-xl font-bold uppercase tracking-wide text-white">You&apos;re on the list!</p>
                    <p className="mt-2 text-sm text-white/50">
                      We&apos;ll message you on WhatsApp the moment prices drop.
                    </p>
                  </div>
                  <button
                    onClick={closeModal}
                    className="mt-2 rounded-xl border border-white/10 bg-white/5 px-8 py-3 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div className="mb-5 text-center">
                    <h2 className="text-2xl font-black uppercase tracking-wider text-white">
                      🔔 Get Deal Alerts
                    </h2>
                    <p className="mt-2 text-sm text-white/55">
                      Free WhatsApp alerts when prices drop. Never spam.
                    </p>
                  </div>

                  {/* Form */}
                  <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                    {/* Row 1: Name + Email */}
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Full Name *"
                        required
                        disabled={status === "loading"}
                        className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#d4a017]/60 focus:bg-white/[0.09] disabled:opacity-50"
                      />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email *"
                        required
                        disabled={status === "loading"}
                        className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#d4a017]/60 focus:bg-white/[0.09] disabled:opacity-50"
                      />
                    </div>

                    {/* Row 2: Country code + WhatsApp */}
                    <div className="flex gap-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06]">
                      <select
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        disabled={status === "loading"}
                        className="shrink-0 bg-transparent px-3 py-3 text-sm text-white outline-none disabled:opacity-50"
                      >
                        {COUNTRY_CODES.map((c) => (
                          <option key={c.code} value={c.code} className="bg-[#1a1a1e] text-white">
                            {c.flag} {c.code}
                          </option>
                        ))}
                      </select>
                      <div className="my-3 w-px bg-white/10" />
                      <input
                        type="tel"
                        value={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.value)}
                        placeholder="WhatsApp number *"
                        required
                        disabled={status === "loading"}
                        className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder-white/30 outline-none disabled:opacity-50"
                      />
                    </div>

                    {/* Row 3: Preferred area */}
                    <input
                      type="text"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      placeholder="Preferred area (optional)"
                      disabled={status === "loading"}
                      className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#d4a017]/60 focus:bg-white/[0.09] disabled:opacity-50"
                    />

                    {/* Row 4: Budget + City */}
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                        disabled={status === "loading"}
                        className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none disabled:opacity-50"
                      >
                        {BUDGET_OPTIONS.map((b) => (
                          <option key={b} value={b} className="bg-[#1a1a1e] text-white">{b}</option>
                        ))}
                      </select>
                      <select
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        disabled={status === "loading"}
                        className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none disabled:opacity-50"
                      >
                        {CITY_OPTIONS.map((c) => (
                          <option key={c} value={c} className="bg-[#1a1a1e] text-white">{c}</option>
                        ))}
                      </select>
                    </div>

                    {status === "error" && (
                      <p className="rounded-xl border border-[#d4a017]/20 bg-[#d4a017]/10 px-4 py-2.5 text-sm text-[#d4a017]">
                        {errorMsg}
                      </p>
                    )}

                    {/* CTA Button */}
                    <button
                      type="submit"
                      disabled={status === "loading"}
                      className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-[#d4a017] py-4 text-sm font-black uppercase tracking-widest text-black shadow-[0_4px_20px_rgba(212,160,23,0.35)] transition-all hover:bg-[#e0aa18] hover:shadow-[0_6px_28px_rgba(212,160,23,0.5)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {status === "loading" ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Subscribing…
                        </>
                      ) : (
                        <>Get Free Alerts 🚨</>
                      )}
                    </button>
                  </form>
                </>
              )}
            </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

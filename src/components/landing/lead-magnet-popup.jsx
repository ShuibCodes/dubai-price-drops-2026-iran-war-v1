"use client";

import { useEffect, useState } from "react";

const POPUP_DELAY_MS = 3000;

export default function LeadMagnetPopup() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOpen(true);
    }, POPUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const cleanName = name.trim();
    const cleanEmail = email.trim();
    if (!cleanName || !cleanEmail) {
      setError("Please enter your name and email.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/lead-magnet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          source: "landing_popup_one_pager",
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Something went wrong. Please try again.");
      }

      if (typeof window !== "undefined" && typeof window.datafast === "function") {
        try {
          window.datafast("lead_magnet_submit", { location: "landing_popup" });
        } catch {
          // ignore analytics errors
        }
      }

      setSubmitted(true);
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <style>{`
        .az-lm-overlay {
          --az-bg: #0c0c0c;
          --az-border: #262626;
          --az-field: #121212;
          --az-field-border: #2e2e2e;
          --az-text: #ffffff;
          --az-muted: #a9a9a9;
          --az-label: #bdbdbd;
          --az-small: #9a9a9a;
          --az-green: #6fd38f;
          --az-yellow: #ffd43b;
          --wa-out: #264c39;
          --wa-in: #242626;
          --wa-text: #fafafa;
          --wa-time: #a8b7b0;
          --font: var(--font-sans), 'DM Sans', system-ui, -apple-system, sans-serif;
          --mono: var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace;
          --wa-font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;

          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background: rgba(0, 0, 0, 0.72);
          font-family: var(--font);
          color: var(--az-text);
          animation: azLmFadeIn 0.22s ease-out;
        }

        @keyframes azLmFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .az-lm-popup {
          position: relative;
          width: 100%;
          max-width: 340px;
          max-height: calc(100vh - 32px);
          overflow: auto;
          background: var(--az-bg);
          border: 1.5px solid var(--az-border);
          border-radius: 22px;
          box-sizing: border-box;
        }

        .az-lm-close {
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 2;
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.6);
          border: 1px solid #3a3a3a;
          cursor: pointer;
        }
        .az-lm-close:focus-visible {
          outline: 2px solid var(--az-green);
          outline-offset: 2px;
        }

        .az-lm-visual {
          position: relative;
          height: 140px;
          overflow: hidden;
          border-bottom: 1px solid #1f1f1f;
          background: #0a0a0a url('/whatsapp-bg.png') center / cover no-repeat;
        }

        .az-lm-phone {
          position: absolute;
          left: 50%;
          top: 16px;
          width: 200px;
          height: 150px;
          transform: translateX(-50%);
          box-sizing: border-box;
          border: 6px solid #2a2a2a;
          border-bottom: 0;
          border-radius: 26px 26px 0 0;
          background: rgba(10, 10, 10, 0.55);
          padding: 10px 8px 0;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          overflow: hidden;
          font-family: var(--wa-font);
        }

        .az-lm-notch,
        .az-lm-chat-head,
        .az-lm-msg,
        .az-lm-desktop-only {
          display: none;
        }

        .az-lm-chat {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        @media (max-width: 699px) {
          .az-lm-phone {
            top: 10px;
            padding-top: 8px;
          }
          .az-lm-pdf svg {
            height: 50px;
          }
        }

        .az-lm-pdf-bubble {
          background: var(--wa-out);
          border-radius: 10px;
          padding: 4px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .az-lm-pdf {
          width: 112px;
          background: #ffffff;
          border-radius: 6px;
          overflow: hidden;
          font-family: var(--font);
        }

        .az-lm-pdf svg {
          display: block;
          width: 100%;
          height: auto;
        }

        .az-lm-pdf-body {
          padding: 5px 6px 6px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .az-lm-pdf-area {
          font-size: 6px;
          letter-spacing: 0.1em;
          color: #888;
          display: none;
        }

        .az-lm-pdf-price {
          font-size: 9px;
          font-weight: 600;
          color: #111;
        }

        .az-lm-pdf-specs {
          font-size: 6.5px;
          color: #555;
        }

        .az-lm-pdf-agent {
          display: flex;
          align-items: center;
          gap: 3px;
          margin-top: 2px;
          padding-top: 3px;
          border-top: 1px solid #ececec;
          font-size: 6px;
          color: #333;
        }

        .az-lm-pdf-agent span:first-child {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--az-green);
          flex-shrink: 0;
        }

        .az-lm-pdf-meta {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          padding: 0 2px 1px;
          font-size: 8px;
          color: var(--wa-time);
        }

        .az-lm-content {
          padding: 20px 20px 22px;
          display: flex;
          flex-direction: column;
        }

        .az-lm-eyebrow {
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.18em;
          color: var(--az-green);
        }

        .az-lm-title {
          margin: 8px 0 0;
          font-size: 23px;
          line-height: 1.18;
          font-weight: 600;
          letter-spacing: -0.015em;
          color: var(--az-text);
        }

        .az-lm-body {
          margin: 10px 0 0;
          font-size: 14.5px;
          line-height: 1.45;
          color: var(--az-muted);
        }

        .az-lm-form {
          margin: 18px 0 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .az-lm-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 13px;
          color: var(--az-label);
        }

        .az-lm-field input {
          height: 48px;
          box-sizing: border-box;
          padding: 0 14px;
          background: var(--az-field);
          border: 1.5px solid var(--az-field-border);
          border-radius: 12px;
          color: var(--az-text);
          font-family: var(--font);
          font-size: 16px;
          outline: none;
          transition: border-color 0.15s ease;
        }

        .az-lm-field input::placeholder {
          color: #6f6f6f;
        }

        .az-lm-field input:focus {
          border-color: var(--az-green);
        }

        .az-lm-submit {
          margin-top: 4px;
          height: 52px;
          border: 0;
          border-radius: 12px;
          background: var(--az-green);
          color: #000;
          font-family: var(--font);
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: filter 0.15s ease, transform 0.1s ease;
        }

        .az-lm-submit:hover:not(:disabled) {
          filter: brightness(1.08);
        }

        .az-lm-submit:active:not(:disabled) {
          transform: scale(0.99);
        }

        .az-lm-submit:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .az-lm-submit:focus-visible {
          outline: 2px solid #fff;
          outline-offset: 2px;
        }

        .az-lm-note {
          margin: 10px 0 0;
          text-align: center;
          font-size: 12.5px;
          color: var(--az-small);
        }

        .az-lm-error {
          margin: 4px 0 0;
          font-size: 13px;
          color: #ff6b81;
        }

        .az-lm-success {
          margin-top: 20px;
          padding: 18px;
          border-radius: 14px;
          border: 1px solid rgba(111, 211, 143, 0.35);
          background: rgba(111, 211, 143, 0.08);
        }

        .az-lm-success-title {
          margin: 0;
          font-size: 17px;
          font-weight: 600;
          color: var(--az-green);
        }

        .az-lm-success-body {
          margin: 8px 0 0;
          font-size: 14px;
          line-height: 1.5;
          color: var(--az-muted);
        }

        @media (min-width: 700px) {
          .az-lm-popup {
            max-width: 640px;
            border-radius: 24px;
            display: grid;
            grid-template-columns: 250px 1fr;
            overflow: hidden;
          }

          .az-lm-visual {
            height: auto;
            min-height: 100%;
            border-bottom: 0;
            border-right: 1px solid #1f1f1f;
            display: flex;
            justify-content: center;
            padding-top: 36px;
          }

          .az-lm-phone {
            position: relative;
            left: auto;
            top: auto;
            transform: none;
            width: 196px;
            height: 520px;
            border: 7px solid #2a2a2a;
            border-radius: 34px;
            padding: 0;
            align-items: stretch;
            gap: 0;
            background: rgba(10, 10, 10, 0.6);
          }

          .az-lm-notch {
            display: flex;
            justify-content: center;
            padding-top: 7px;
          }

          .az-lm-notch span {
            width: 64px;
            height: 18px;
            border-radius: 9px;
            background: #000;
          }

          .az-lm-chat-head {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 8px 10px;
            margin-top: 6px;
            background: #1d1e1e;
            font-size: 11px;
            font-weight: 600;
            color: #e9edef;
          }

          .az-lm-chat-head span:first-child {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #6b7c85;
          }

          .az-lm-chat {
            padding: 12px 8px 0;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
          }

          .az-lm-msg {
            display: block;
            max-width: 150px;
            border-radius: 9px;
            padding: 6px 8px;
            font-size: 10px;
            line-height: 1.35;
            color: var(--wa-text);
          }

          .az-lm-msg-out {
            background: var(--wa-out);
          }

          .az-lm-msg-in {
            background: var(--wa-in);
            align-self: flex-start;
            max-width: 140px;
          }

          .az-lm-desktop-only {
            display: inline;
          }

          .az-lm-pdf {
            width: 148px;
          }

          .az-lm-pdf-body {
            padding: 7px 8px 8px;
            gap: 4px;
          }

          .az-lm-pdf-area {
            display: block;
            font-size: 7px;
          }

          .az-lm-pdf-price {
            font-size: 12px;
          }

          .az-lm-pdf-specs {
            font-size: 8px;
          }

          .az-lm-pdf-agent {
            font-size: 7.5px;
            gap: 5px;
            margin-top: 3px;
            padding-top: 5px;
          }

          .az-lm-pdf-agent span:first-child {
            width: 13px;
            height: 13px;
          }

          .az-lm-pdf-meta {
            justify-content: space-between;
            font-size: 8.5px;
            padding: 0 3px 2px;
          }

          .az-lm-close {
            top: 12px;
            right: 12px;
            background: transparent;
          }

          .az-lm-content {
            padding: 36px 32px 30px;
          }

          .az-lm-title {
            font-size: 27px;
            line-height: 1.15;
            margin: 10px 44px 0 0;
          }

          .az-lm-body {
            font-size: 15px;
            line-height: 1.5;
            margin-top: 12px;
          }

          .az-lm-form {
            margin-top: 22px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .az-lm-overlay {
            animation: none;
          }
          .az-lm-submit,
          .az-lm-field input {
            transition: none;
          }
        }
      `}</style>

      <div
        className="az-lm-overlay"
        id="az-popup"
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div
          className="az-lm-popup"
          role="dialog"
          aria-modal="true"
          aria-labelledby="az-title"
        >
          <button
            className="az-lm-close"
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2 L12 12 M12 2 L2 12"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          {/* Visual: phone with WhatsApp chat + one-pager PDF */}
          <div className="az-lm-visual" aria-hidden="true">
            <div className="az-lm-phone">
              <div className="az-lm-notch">
                <span />
              </div>
              <div className="az-lm-chat-head">
                <span />
                <span>Buyer</span>
              </div>
              <div className="az-lm-chat">
                <div className="az-lm-msg az-lm-msg-out">
                  Here&apos;s the Marina 2 bed we spoke about
                </div>
                <div className="az-lm-pdf-bubble">
                  <div className="az-lm-pdf">
                    <svg viewBox="0 0 112 60" preserveAspectRatio="xMidYMid slice">
                      <rect width="112" height="60" fill="#1e2c3c" />
                      <circle cx="86" cy="19" r="7" fill="#ffd43b" />
                      <rect x="6" y="18" width="10" height="32" fill="#34465a" />
                      <rect x="18" y="8" width="12" height="42" fill="#2b3b4d" />
                      <rect x="32" y="22" width="9" height="28" fill="#3b4f66" />
                      <rect x="44" y="3" width="11" height="47" fill="#25354a" />
                      <rect x="58" y="14" width="10" height="36" fill="#34465a" />
                      <rect x="70" y="26" width="12" height="24" fill="#2b3b4d" />
                      <rect x="92" y="12" width="11" height="38" fill="#3b4f66" />
                      <rect x="0" y="50" width="112" height="10" fill="#142231" />
                      <path
                        d="M8 54 H20 M30 56 H44 M58 54 H70 M84 56 H98"
                        stroke="#2f4a63"
                        strokeWidth="1"
                      />
                    </svg>
                    <div className="az-lm-pdf-body">
                      <span className="az-lm-pdf-area">DUBAI MARINA</span>
                      <span className="az-lm-pdf-price">AED 2,450,000</span>
                      <span className="az-lm-pdf-specs">
                        2 bed · 2 bath · 1,250 sq ft
                      </span>
                      <div className="az-lm-pdf-agent">
                        <span />
                        <span>Your name · Your agency</span>
                      </div>
                    </div>
                  </div>
                  <div className="az-lm-pdf-meta">
                    <span>
                      Marina_2BR.pdf
                      <span className="az-lm-desktop-only"> · 1 page</span>
                    </span>
                    <span>09:43</span>
                  </div>
                </div>
                <div className="az-lm-msg az-lm-msg-in">
                  This is great, can we view Saturday?
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="az-lm-content">
            <span className="az-lm-eyebrow">FREE TOOL</span>
            <h2 className="az-lm-title" id="az-title">
              Send buyers something better than a portal link
            </h2>
            <p className="az-lm-body">
              Paste a link, and have AI create a clean, branded one-pager. Stand
              out from the rest.
            </p>

            {submitted ? (
              <div className="az-lm-success" role="status">
                <p className="az-lm-success-title">You&apos;re in — check your inbox!</p>
                <p className="az-lm-success-body">
                  We&apos;ve sent your free access link to{" "}
                  <strong style={{ color: "#fff" }}>{email.trim()}</strong>. You
                  can also open the tool now.
                </p>
                <a
                  href="/ai-proposal-generator"
                  className="az-lm-submit"
                  style={{
                    width: "100%",
                    marginTop: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textDecoration: "none",
                  }}
                >
                  Open one-pager tool
                </a>
                <button
                  type="button"
                  className="az-lm-submit"
                  style={{
                    width: "100%",
                    marginTop: "10px",
                    background: "transparent",
                    color: "#fff",
                    border: "1px solid #3a3a3a",
                  }}
                  onClick={() => setOpen(false)}
                >
                  Back to AgentZero
                </button>
              </div>
            ) : (
              <>
                <form className="az-lm-form" onSubmit={handleSubmit}>
                  <label className="az-lm-field">
                    Name
                    <input
                      type="text"
                      name="name"
                      placeholder="Your name"
                      autoComplete="name"
                      required
                      disabled={submitting}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="az-lm-field">
                    Email
                    <input
                      type="email"
                      name="email"
                      placeholder="you@agency.ae"
                      autoComplete="email"
                      required
                      disabled={submitting}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  {error ? (
                    <p className="az-lm-error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <button
                    className="az-lm-submit"
                    type="submit"
                    disabled={submitting}
                  >
                    {submitting ? "Sending..." : "Get free access"}
                  </button>
                </form>
                <p className="az-lm-note">Takes 10 seconds. No card needed.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

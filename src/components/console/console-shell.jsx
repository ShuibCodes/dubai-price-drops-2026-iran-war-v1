"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { consoleBase } from "@/lib/console/client";
import { waDeepLink } from "@/lib/console/format";

// `match` widens the active check when the tab links at one child route but
// owns a whole section — Runs points at /runs/new yet also covers /runs/<id>.
const NAV = [
  { href: "", label: "Home" },
  { href: "/how-it-works", label: "Journey" },
  { href: "/scripts", label: "Scripts" },
  { href: "/runs/new", label: "Runs", match: "/runs" },
  { href: "/kb", label: "Knowledge" },
  { href: "/settings", label: "Settings" },
];

const GENERIC_WA = "https://wa.me/";

const WIDTH = {
  620: "max-w-[620px]",
  760: "max-w-[760px]",
  820: "max-w-[820px]",
  880: "max-w-[880px]",
  1040: "max-w-[1040px]",
};

const TAB =
  "cursor-pointer whitespace-nowrap rounded-lg px-3.5 py-2.5 font-mono text-xs font-medium uppercase tracking-[.1em] transition-colors";

const LOGOUT =
  "p-1.5 font-mono text-[11px] tracking-[.1em] text-ghost hover:text-[#a7b0ac]";

async function logout() {
  try {
    await fetch("/api/copilot/auth", { method: "DELETE" });
  } catch {
    // leave anyway
  }
  window.location.href = "/copilot";
}

// The tenant number rarely changes and most screens have no reason to load it,
// so resolve it once per session and share it across navigations.
const waLinkCache = new Map();

function useWaLink(base, provided) {
  const [resolved, setResolved] = useState(
    () => provided || waLinkCache.get(base) || ""
  );

  useEffect(() => {
    if (provided || waLinkCache.has(base)) return undefined;
    let live = true;
    fetch("/api/console/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const link = waDeepLink(body?.number);
        waLinkCache.set(base, link);
        if (live) setResolved(link);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [base, provided]);

  return provided || resolved || GENERIC_WA;
}

function TopNav({ base, waLink }) {
  const path = usePathname() || "";

  function isActive(item) {
    const prefix = item.match ?? item.href;
    if (!prefix) return path === base || path === `${base}/`;
    const target = `${base}${prefix}`;
    return path === target || path.startsWith(`${target}/`);
  }

  return (
    <div className="sticky top-0 z-40 border-b border-line bg-shell/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1040px] flex-wrap items-center gap-x-7 gap-y-3 px-6 py-3.5">
        <span className="font-mono text-[13px] font-bold tracking-[.14em] text-fg">
          AGENTZERO
        </span>

        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto p-0.5">
          {NAV.map((item) => (
            <Link
              className={`${TAB} ${
                isActive(item)
                  ? "border border-az bg-az text-az-ink shadow-[0_0_0_3px_rgba(53,224,139,.16)]"
                  : "border border-line-2 bg-[#101413] text-[#a7b0ac] hover:border-line-3 hover:text-fg"
              }`}
              href={`${base}${item.href}`}
              key={item.href || "home"}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <a
          className="flex items-center gap-2 rounded-full border border-az-edge bg-[#0d1a13] px-3.5 py-2 text-[13px] font-medium text-az hover:border-az"
          href={waLink}
          rel="noreferrer"
          target="_blank"
        >
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-az" />
          Open WhatsApp
        </a>

        <button className={LOGOUT} onClick={logout} type="button">
          LOG OUT
        </button>
      </div>
    </div>
  );
}

// The join wizard hides the nav so a half-onboarded agent is not sent into
// screens that need setup — but they still need a way out.
function BareBar() {
  return (
    <div className="border-b border-line">
      <div className="mx-auto flex max-w-[1040px] items-center justify-between px-6 py-3.5">
        <span className="font-mono text-[13px] font-bold tracking-[.14em] text-fg">
          AGENTZERO
        </span>
        <button className={LOGOUT} onClick={logout} type="button">
          LOG OUT
        </button>
      </div>
    </div>
  );
}

export function WaFooter({ waLink = GENERIC_WA }) {
  return (
    <div className="mt-14 flex flex-wrap items-center justify-between gap-5 rounded-[14px] border border-line-2 bg-panel px-7 py-6">
      <div>
        <div className="text-lg font-semibold text-fg">
          The work happens in WhatsApp.
        </div>
        <div className="mt-1.5 text-[15px] text-dim">
          Text <span className="font-mono text-az">summary</span> to see where
          your pipeline stands.
        </div>
      </div>
      <a
        className="rounded-[10px] bg-az px-6 py-3.5 text-base font-semibold text-az-ink hover:bg-az-hover"
        href={waLink}
        rel="noreferrer"
        target="_blank"
      >
        Go back to WhatsApp →
      </a>
    </div>
  );
}

export function ConsoleShell({
  tenant,
  children,
  bare = false,
  footer = true,
  width = 1040,
  waLink,
}) {
  const base = consoleBase(tenant);
  const link = useWaLink(base, bare ? GENERIC_WA : waLink);

  return (
    <main className="az-shell min-h-screen font-sans">
      {bare ? <BareBar /> : <TopNav base={base} waLink={link} />}
      <div className={`mx-auto ${WIDTH[width] || WIDTH[1040]} px-6 pb-28 pt-12`}>
        {children}
        {footer ? <WaFooter waLink={link} /> : null}
      </div>
    </main>
  );
}

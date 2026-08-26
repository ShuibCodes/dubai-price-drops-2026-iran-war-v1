"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "", label: "Home" },
  { href: "/how-it-works", label: "Journey" },
  { href: "/scripts", label: "Scripts" },
  { href: "/runs/new", label: "Runs" },
  { href: "/kb", label: "Knowledge" },
  { href: "/settings", label: "Settings" },
];

const WIDTH = {
  620: "max-w-[620px]",
  760: "max-w-[760px]",
  820: "max-w-[820px]",
  880: "max-w-[880px]",
  1040: "max-w-[1040px]",
};

const TAB =
  "cursor-pointer whitespace-nowrap rounded-lg px-3.5 py-2.5 font-mono text-xs font-medium uppercase tracking-[.1em] transition-colors";

function TopNav({ base, waLink }) {
  const path = usePathname() || "";

  async function logout() {
    try {
      await fetch("/api/copilot/auth", { method: "DELETE" });
    } catch {
      // leave anyway
    }
    window.location.href = "/copilot/login";
  }

  function isActive(href) {
    const target = `${base}${href}`;
    if (!href) return path === base || path === `${base}/`;
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
                isActive(item.href)
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

        <button
          className="p-1.5 font-mono text-[11px] tracking-[.1em] text-ghost hover:text-[#a7b0ac]"
          onClick={logout}
          type="button"
        >
          LOG OUT
        </button>
      </div>
    </div>
  );
}

export function WaFooter({ waLink = "https://wa.me/" }) {
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
  waLink = "https://wa.me/",
}) {
  const base = `/copilot/${encodeURIComponent(tenant)}`;

  return (
    <main className="az-shell min-h-screen font-sans">
      {bare ? null : <TopNav base={base} waLink={waLink} />}
      <div className={`mx-auto ${WIDTH[width] || WIDTH[1040]} px-6 pb-28 pt-12`}>
        {children}
        {footer ? <WaFooter waLink={waLink} /> : null}
      </div>
    </main>
  );
}

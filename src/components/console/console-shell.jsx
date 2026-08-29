"use client";

import Link from "next/link";

const NAV = [
  { href: "", label: "Home" },
  { href: "/scripts", label: "Scripts" },
  { href: "/runs/new", label: "Runs" },
  { href: "/kb", label: "KB" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/settings", label: "Settings" },
];

export function ConsoleShell({ tenant, title, action, children, bare = false }) {
  async function logout() {
    try {
      await fetch("/api/copilot/auth", { method: "DELETE" });
    } catch {
      // still leave
    }
    window.location.href = "/copilot";
  }

  const base = `/copilot/${encodeURIComponent(tenant)}`;

  return (
    <main className="min-h-screen bg-background text-ink">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {!bare ? (
          <nav className="mb-8 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-label text-ink-3">
            {NAV.map((item) => (
              <Link
                className="hover:text-ink"
                href={`${base}${item.href}`}
                key={item.href || "home"}
              >
                {item.label}
              </Link>
            ))}
            <button
              className="ml-auto hover:text-ink"
              onClick={logout}
              type="button"
            >
              Log out
            </button>
          </nav>
        ) : null}
        <header className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-label text-ink-3">
              {tenant}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            {action}
            {bare ? (
              <button
                className="font-mono text-[10px] uppercase tracking-label text-ink-3 hover:text-ink-2"
                onClick={logout}
                type="button"
              >
                Log out
              </button>
            ) : null}
          </div>
        </header>
        {children}
        <p className="mt-10 font-mono text-[10px] uppercase tracking-label text-ink-3">
          When you’re done,{" "}
          <a className="underline underline-offset-2 hover:text-ink" href="https://wa.me/">
            go back to WhatsApp
          </a>
          .
        </p>
      </div>
    </main>
  );
}

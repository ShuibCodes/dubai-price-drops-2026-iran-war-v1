"use client";

import { useState } from "react";

export function Tooltip({ children, align = "left" }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        aria-label="What is this?"
        className="grid h-[17px] w-[17px] place-items-center rounded-full border border-line-3 text-[10px] text-dim hover:border-az hover:text-az"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        ?
      </button>
      {open ? (
        <span
          className={`absolute top-6 z-20 w-[260px] animate-pop rounded-[10px] border border-[#2c332f] bg-[#151a18] px-3.5 py-3 text-[13px] font-normal normal-case leading-normal tracking-normal text-fg-soft ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}

"use client";

import { useState } from "react";

export function Expandable({ head, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        className="az-row hover:bg-panel"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        {head(open)}
      </button>
      {open ? children : null}
    </>
  );
}

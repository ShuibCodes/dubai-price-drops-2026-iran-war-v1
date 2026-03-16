"use client";

import { useEffect, useState } from "react";
import { formatAreaTimestamp } from "@/lib/format";

export default function TimestampDivider({ count }) {
  const [timestamp, setTimestamp] = useState("");

  useEffect(() => {
    setTimestamp(formatAreaTimestamp(new Date()));

    const interval = window.setInterval(() => {
      setTimestamp(formatAreaTimestamp(new Date()));
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="mono rounded-full border border-white/10 bg-black/35 px-4 py-3 text-[11px] uppercase tracking-[0.28em] text-white/45">
      {`► ${count} pre-war gaps detected · ${timestamp} GMT+4`}
    </div>
  );
}

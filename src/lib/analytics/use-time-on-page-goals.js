"use client";

import { useEffect } from "react";

function labelFor(seconds) {
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

/**
 * Fires one DataFast goal per milestone, e.g. deals_stayed_30s, deals_stayed_2m.
 * Only time with the tab visible counts, so a backgrounded tab doesn't inflate it.
 */
export function useTimeOnPageGoals(prefix, milestoneSeconds) {
  const key = milestoneSeconds.join(",");

  useEffect(() => {
    const milestones = key.split(",").map(Number).sort((a, b) => a - b);
    const fired = new Set();
    let visibleMs = 0;
    let visibleSince = document.visibilityState === "visible" ? Date.now() : null;

    const check = () => {
      const totalSeconds = (visibleMs + (visibleSince ? Date.now() - visibleSince : 0)) / 1000;
      for (const seconds of milestones) {
        if (totalSeconds >= seconds && !fired.has(seconds)) {
          fired.add(seconds);
          window.datafast?.(`${prefix}_${labelFor(seconds)}`);
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        visibleSince = Date.now();
      } else if (visibleSince) {
        visibleMs += Date.now() - visibleSince;
        visibleSince = null;
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => {
      check();
      if (fired.size === milestones.length) clearInterval(timer);
    }, 5000);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [prefix, key]);
}

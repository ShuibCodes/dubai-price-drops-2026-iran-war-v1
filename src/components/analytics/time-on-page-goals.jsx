"use client";

import { useTimeOnPageGoals } from "@/lib/analytics/use-time-on-page-goals";

export default function TimeOnPageGoals({ prefix, milestones }) {
  useTimeOnPageGoals(prefix, milestones);
  return null;
}

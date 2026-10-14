"use client";

import { Button } from "@/components/ui/button";

export function CalendarConnect({ disabled, next = "settings" }) {
  const href =
    next === "join"
      ? "/api/console/calendar/connect?next=join"
      : "/api/console/calendar/connect";

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-ink-2">
        Connect the Google Calendar this agent uses for viewings. AgentZero
        stores the connection against your account only — not the whole tenant,
        and never as a Vapi variable.
      </p>
      <Button
        disabled={disabled}
        onClick={() => {
          window.location.href = href;
        }}
      >
        Connect Google Calendar
      </Button>
    </div>
  );
}

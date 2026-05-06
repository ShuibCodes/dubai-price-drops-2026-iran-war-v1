"use client";

import { useCallback, useState } from "react";
import AgentRosterForm from "@/components/onboard/AgentRosterForm";
import UploadProgress from "@/components/onboard/UploadProgress";

export default function OnboardPage() {
  const [showPlaceholderIntegrations, setShowPlaceholderIntegrations] =
    useState(false);

  const handleInitialLoadComplete = useCallback(() => {
    setShowPlaceholderIntegrations(true);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
          AgentZero Setup
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Configure your brokerage and agent roster. Integration steps below are
          placeholders for a later phase.
        </p>
      </header>

      <AgentRosterForm onInitialLoadComplete={handleInitialLoadComplete} />
      {showPlaceholderIntegrations ? <UploadProgress /> : null}
    </div>
  );
}

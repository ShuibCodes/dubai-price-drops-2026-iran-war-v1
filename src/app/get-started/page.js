import { Suspense } from "react";
import { GetStartedFlow } from "@/components/landing/get-started-flow";
import { isSocialProviderConfigured } from "@/lib/copilot/social-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Get started now — AgentZero (AED 750/m)",
  description:
    "Next 5 individual brokers only: 5-day free trial, then AED 750/month. Interest-free installments — pay over 3. Dedicated account manager included.",
};

export default function GetStartedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <GetStartedFlow
        googleEnabled={isSocialProviderConfigured("google")}
        facebookEnabled={isSocialProviderConfigured("facebook")}
      />
    </Suspense>
  );
}

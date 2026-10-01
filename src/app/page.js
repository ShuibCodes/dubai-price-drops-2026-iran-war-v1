import AgentZeroLandingPage from "@/components/landing/agentzero-landing-page";
import Script from "next/script";

export const metadata = {
  title: "AgentZero — Sterling Boulevard Real Estate",
  description:
    "AI agent for real estate brokerages. Calls leads, books viewings, emails listing packs — all from WhatsApp. No new app.",
};

export default function Home() {
  return (
    <>
      <Script
        defer
        data-website-id="dfid_aqzPmo9l06RAI6kjno3Ok"
        data-domain="agentzero.ae"
        src="https://datafa.st/js/script.js"
      />
      <AgentZeroLandingPage />
    </>
  );
}

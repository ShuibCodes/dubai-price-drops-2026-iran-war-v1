import AgentZeroLandingPage from "@/components/landing/agentzero-landing-page";
import Script from "next/script";
import { SHARE_IMAGE } from "@/lib/share-image";

const TITLE = "AgentZero — Your CRM has 4,000 leads. When did you last call one?";
const DESCRIPTION =
  "AI agent for real estate brokerages. Calls leads, books viewings, emails listing packs — all from WhatsApp. No new app.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "AgentZero",
    locale: "en_AE",
    type: "website",
    url: "/",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE.url],
  },
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

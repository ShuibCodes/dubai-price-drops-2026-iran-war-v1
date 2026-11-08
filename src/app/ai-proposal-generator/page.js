import ProposalGeneratorClient from "@/components/proposal/proposal-generator-client";
import { SHARE_IMAGE } from "@/lib/share-image";

const TITLE = "AI Proposal Generator — AgentZero";
const DESCRIPTION =
  "Paste a Property Finder or Bayut listing link and get a clean, branded one-pager PDF with your name and company.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "AgentZero",
    locale: "en_AE",
    type: "website",
    url: "/ai-proposal-generator",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE.url],
  },
};

export default function AiProposalGeneratorPage() {
  return <ProposalGeneratorClient />;
}

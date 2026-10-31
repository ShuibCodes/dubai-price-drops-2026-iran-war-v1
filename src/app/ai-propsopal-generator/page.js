import { redirect } from "next/navigation";

export const metadata = {
  title: "AI Proposal Generator — AgentZero",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AiPropsopalGeneratorRedirectPage() {
  redirect("/ai-proposal-generator");
}

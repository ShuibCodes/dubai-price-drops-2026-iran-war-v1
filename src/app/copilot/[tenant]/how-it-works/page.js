import { HowItWorks } from "@/components/console/how-it-works";

export const dynamic = "force-dynamic";

export default function HowItWorksPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <HowItWorks tenant={tenant} />;
}

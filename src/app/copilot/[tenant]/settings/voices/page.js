import { VoicesPage } from "@/components/console/voices-page";

export const dynamic = "force-dynamic";

export default function CopilotVoicesPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <VoicesPage tenant={tenant} />;
}

import { SettingsPage } from "@/components/console/settings-page";

export const dynamic = "force-dynamic";

export default function CopilotSettingsPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <SettingsPage tenant={tenant} />;
}

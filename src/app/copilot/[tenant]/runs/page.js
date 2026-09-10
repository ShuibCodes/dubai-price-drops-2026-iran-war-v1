import { ConsoleRuns } from "@/components/console/console-runs";

export const dynamic = "force-dynamic";

export default function CopilotRunsPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <ConsoleRuns tenant={tenant} />;
}

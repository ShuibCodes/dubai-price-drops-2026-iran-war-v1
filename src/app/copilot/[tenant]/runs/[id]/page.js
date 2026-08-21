import { RunResults } from "@/components/console/run-results";

export const dynamic = "force-dynamic";

export default function RunPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  const id = String(params?.id || "").trim();
  return <RunResults runId={id} tenant={tenant} />;
}

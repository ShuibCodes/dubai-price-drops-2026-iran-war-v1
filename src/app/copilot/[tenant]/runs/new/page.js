import { RunBuilder } from "@/components/console/run-builder";

export const dynamic = "force-dynamic";

export default function NewRunPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <RunBuilder tenant={tenant} />;
}

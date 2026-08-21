import { JoinWizard } from "@/components/console/join-wizard";

export const dynamic = "force-dynamic";

export default function JoinPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <JoinWizard tenant={tenant} />;
}

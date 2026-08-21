import { ScriptsList } from "@/components/console/scripts-list";

export const dynamic = "force-dynamic";

export default function ScriptsPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <ScriptsList tenant={tenant} />;
}

import { KbPage } from "@/components/console/kb-page";

export const dynamic = "force-dynamic";

export default function KnowledgePage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <KbPage tenant={tenant} />;
}

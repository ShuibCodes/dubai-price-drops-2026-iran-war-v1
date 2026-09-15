import { JoinWizard } from "@/components/console/join-wizard";

export const dynamic = "force-dynamic";

export default function JoinPage({ params, searchParams }) {
  const tenant = String(params?.tenant || "").trim();
  const previewChoice =
    process.env.NODE_ENV !== "production" &&
    searchParams?.preview === "choice";
  return <JoinWizard previewChoice={previewChoice} tenant={tenant} />;
}

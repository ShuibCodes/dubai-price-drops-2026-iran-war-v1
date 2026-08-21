import { ConsoleHome } from "@/components/console/console-home";

export const dynamic = "force-dynamic";

export default function CopilotHomePage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <ConsoleHome tenant={tenant} />;
}

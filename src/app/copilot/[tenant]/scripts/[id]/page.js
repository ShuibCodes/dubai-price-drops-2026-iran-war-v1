import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ScriptEditor } from "@/components/console/script-editor";
import { getSession } from "@/lib/copilot/session";

export const dynamic = "force-dynamic";

export default async function ScriptEditorPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  const scriptId = String(params?.id || "").trim();
  const session = await getSession(await cookies(), { tenantSlug: tenant });
  if (!session) {
    redirect(`/copilot/login?next=/copilot/${encodeURIComponent(tenant)}/scripts/${scriptId}`);
  }

  return (
    <ScriptEditor
      role={session.role}
      scriptId={scriptId}
      tenant={tenant}
      waPhone={session.waPhone}
    />
  );
}

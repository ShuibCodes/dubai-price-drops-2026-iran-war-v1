import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COPILOT_SESSION_COOKIE, verifyCopilotSessionToken } from "@/lib/copilot-auth";
import { getSession } from "@/lib/copilot/session";

export default async function ProtectedCopilotLayout({ children, params }) {
  const tenant = String(params?.tenant || "").trim();
  const cookieStore = await cookies();
  const token = cookieStore.get(COPILOT_SESSION_COOKIE)?.value;
  const payload = verifyCopilotSessionToken(token);

  if (payload && payload.tenantSlug !== tenant) {
    redirect(`/copilot/${encodeURIComponent(payload.tenantSlug)}`);
  }

  const session = await getSession(cookieStore, { tenantSlug: tenant });
  if (!session) {
    redirect(`/copilot?next=/copilot/${encodeURIComponent(tenant)}`);
  }

  return children;
}

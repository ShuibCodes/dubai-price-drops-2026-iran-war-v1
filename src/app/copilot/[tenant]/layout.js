import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COPILOT_SESSION_COOKIE,
  sessionAllowsTenant,
  verifyCopilotSessionToken,
} from "@/lib/copilot-auth";

export default async function ProtectedCopilotLayout({ children, params }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COPILOT_SESSION_COOKIE)?.value;
  const session = token ? verifyCopilotSessionToken(token) : null;
  const tenant = String(params?.tenant || "").trim();

  if (!session) {
    redirect(`/copilot/login?next=/copilot/${encodeURIComponent(tenant)}`);
  }

  if (!sessionAllowsTenant(session, tenant)) {
    redirect(`/copilot/${encodeURIComponent(session.tenantSlug)}`);
  }

  return children;
}

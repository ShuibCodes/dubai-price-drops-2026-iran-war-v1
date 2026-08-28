import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/copilot/session";

export default async function ProtectedCopilotLayout({ children, params }) {
  const tenant = String(params?.tenant || "").trim();
  const cookieStore = await cookies();

  // Resolved without a tenant assertion so a wrong-tenant URL redirects to the
  // agent's own console instead of throwing 403 inside a layout.
  const session = await getSession(cookieStore);
  if (!session) {
    redirect(`/copilot/login?next=/copilot/${encodeURIComponent(tenant)}`);
  }
  if (session.tenantSlug !== tenant) {
    redirect(`/copilot/${encodeURIComponent(session.tenantSlug)}`);
  }

  return children;
}

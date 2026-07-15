import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COPILOT_SESSION_COOKIE,
  verifyCopilotSessionToken,
} from "@/lib/copilot-auth";

export default async function ProtectedCopilotLayout({ children, params }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COPILOT_SESSION_COOKIE)?.value;

  if (!token || !verifyCopilotSessionToken(token)) {
    const tenant = encodeURIComponent(String(params?.tenant || ""));
    redirect(`/copilot/login?next=/copilot/${tenant}`);
  }

  return children;
}

import { redirect } from "next/navigation";
import { COPILOT_LOGIN_PATH } from "@/lib/copilot-auth-constants";

export default function CopilotLoginRedirectPage({ searchParams }) {
  const next = typeof searchParams?.next === "string" ? searchParams.next : "";
  if (next.startsWith("/copilot/") && !next.startsWith("//")) {
    redirect(`${COPILOT_LOGIN_PATH}?next=${encodeURIComponent(next)}`);
  }
  redirect(COPILOT_LOGIN_PATH);
}

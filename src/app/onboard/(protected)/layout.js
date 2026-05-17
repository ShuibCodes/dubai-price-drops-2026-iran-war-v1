import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ONBOARD_SESSION_COOKIE,
  verifyOnboardSessionToken,
} from "@/lib/onboard-auth";

export default async function ProtectedOnboardLayout({ children }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ONBOARD_SESSION_COOKIE)?.value;

  if (!token || !verifyOnboardSessionToken(token)) {
    redirect("/onboard/login?from=/onboard");
  }

  return children;
}

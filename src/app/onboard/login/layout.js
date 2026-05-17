import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ONBOARD_SESSION_COOKIE,
  verifyOnboardSessionToken,
} from "@/lib/onboard-auth";

export default async function OnboardLoginLayout({ children }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ONBOARD_SESSION_COOKIE)?.value;

  if (token && verifyOnboardSessionToken(token)) {
    redirect("/onboard");
  }

  return children;
}

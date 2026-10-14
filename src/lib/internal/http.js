import { jsonError } from "@/lib/scripts/http";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  ONBOARD_SESSION_COOKIE,
  verifyOnboardSessionToken,
} from "@/lib/onboard-auth";

function readCookie(source, name) {
  if (!source) return null;
  if (typeof source.cookies?.get === "function") {
    const value = source.cookies.get(name);
    if (typeof value === "string") return value;
    return value?.value || null;
  }
  if (typeof source.get === "function") {
    return source.get(name)?.value || null;
  }
  return null;
}

export function hasOnboardStaffSession(source) {
  const token = readCookie(source, ONBOARD_SESSION_COOKIE);
  return Boolean(token && verifyOnboardSessionToken(token));
}

export async function internalContext(request) {
  if (!hasOnboardStaffSession(request)) {
    return { response: jsonError("Unauthorized", 401) };
  }
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { response: jsonError("Supabase not configured", 500) };
  }
  return { supabase, staff: true };
}

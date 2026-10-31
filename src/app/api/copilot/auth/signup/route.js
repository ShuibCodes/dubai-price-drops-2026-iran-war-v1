import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  COPILOT_SESSION_COOKIE,
  copilotSessionCookieOptions,
  createCopilotSessionToken,
} from "@/lib/copilot-auth";
import { hashPassword, verifyPassword } from "@/lib/copilot/password";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  createRouteAuthClient,
  isSupabaseAuthConfigured,
} from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function cleanName(raw) {
  const name = String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return name ? name.slice(0, 120) : null;
}

async function allocateTenant(supabase, displayName) {
  const workspaceName = displayName ? `${displayName}'s workspace` : "My workspace";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = `workspace-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const { data, error } = await supabase
      .from("tenants")
      .insert({
        name: workspaceName,
        slug,
        daily_dial_cap: 50,
      })
      .select("id, slug, name")
      .maybeSingle();
    if (!error && data?.id) return data;
    if (error && /daily_dial_cap/i.test(String(error.message || ""))) {
      const retry = await supabase
        .from("tenants")
        .insert({ name: workspaceName, slug })
        .select("id, slug, name")
        .maybeSingle();
      if (!retry.error && retry.data?.id) return retry.data;
    }
  }
  throw new Error("Could not create workspace.");
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    const name = cleanName(body.name);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid email address." },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { ok: false, error: "Account creation is not configured on this server." },
        { status: 500 }
      );
    }

    const { data: existing, error: lookupError } = await supabase
      .from("agents")
      .select("id, tenant_id, name, email, username, role, password_hash")
      .ilike("email", email.replace(/[%_\\]/g, "\\$&"))
      .maybeSingle();

    if (lookupError) {
      throw new Error(`Account lookup failed: ${lookupError.message}`);
    }

    let agent = existing;
    let tenantSlug = null;

    if (agent) {
      if (agent.password_hash && !verifyPassword(password, agent.password_hash)) {
        return NextResponse.json(
          {
            ok: false,
            error: "An account with this email already exists. Check your password or sign in.",
          },
          { status: 409 }
        );
      }

      if (!agent.password_hash) {
        const { data: updated, error: updateError } = await supabase
          .from("agents")
          .update({
            password_hash: hashPassword(password),
            username: agent.username || email,
            name: agent.name || name,
            last_login_at: new Date().toISOString(),
          })
          .eq("id", agent.id)
          .select("id, tenant_id, role")
          .single();
        if (updateError) throw new Error(updateError.message);
        agent = updated;
      }

      const { data: tenant } = await supabase
        .from("tenants")
        .select("id, slug")
        .eq("id", agent.tenant_id)
        .maybeSingle();
      tenantSlug = tenant?.slug || null;
    } else {
      const tenant = await allocateTenant(supabase, name);
      tenantSlug = tenant.slug;

      const { data: created, error: createError } = await supabase
        .from("agents")
        .insert({
          tenant_id: tenant.id,
          name,
          email,
          username: email,
          password_hash: hashPassword(password),
          role: "admin",
          onboarded_at: null,
          last_login_at: new Date().toISOString(),
        })
        .select("id, tenant_id, role")
        .single();

      if (createError) {
        throw new Error(`Could not create broker account: ${createError.message}`);
      }
      agent = created;
    }

    if (!agent?.id || !agent?.tenant_id || !tenantSlug) {
      return NextResponse.json(
        { ok: false, error: "Could not resolve workspace." },
        { status: 500 }
      );
    }

    const token = createCopilotSessionToken({
      agentId: agent.id,
      tenantId: agent.tenant_id,
      tenantSlug,
    });

    const response = NextResponse.json({
      ok: true,
      tenantSlug,
    });
    response.cookies.set(COPILOT_SESSION_COOKIE, token, copilotSessionCookieOptions());

    const supabaseCookies = request.cookies
      .getAll()
      .filter((cookie) => cookie.name.startsWith("sb-"));
    if (supabaseCookies.length && isSupabaseAuthConfigured()) {
      try {
        const { supabase: authClient } = createRouteAuthClient(request);
        await authClient.auth.signOut();
      } catch {
        // expire cookies below
      }
    }
    for (const cookie of supabaseCookies) {
      response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    }

    return response;
  } catch (error) {
    console.error("[copilot/auth/signup]", error?.message);
    return NextResponse.json(
      { ok: false, error: error?.message || "Could not create account." },
      { status: 500 }
    );
  }
}

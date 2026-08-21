import { NextResponse } from "next/server";
import {
  COPILOT_SESSION_COOKIE,
  copilotSessionCookieOptions,
  createCopilotSessionToken,
  isCopilotJsonFallbackEnabled,
  verifyCopilotCredentials,
} from "@/lib/copilot-auth";
import { verifyPassword } from "@/lib/copilot/password";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function findAgentByUsername(supabase, username) {
  const name = String(username || "").trim();
  if (!name) return null;
  const { data, error } = await supabase
    .from("agents")
    .select("id, tenant_id, username, role, password_hash, tenants!inner(id, slug)")
    .ilike("username", name.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (error) throw new Error(`Agent lookup failed: ${error.message}`);
  return data || null;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const username = String(body?.username ?? "").trim();
    const password = String(body?.password ?? "");
    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: "Invalid login." },
        { status: 401 }
      );
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { ok: false, error: "Login is not configured on the server." },
        { status: 500 }
      );
    }

    let agent = await findAgentByUsername(supabase, username);

    if (agent?.password_hash) {
      if (!verifyPassword(password, agent.password_hash)) {
        return NextResponse.json(
          { ok: false, error: "Invalid login." },
          { status: 401 }
        );
      }
    } else if (isCopilotJsonFallbackEnabled()) {
      const jsonUser = verifyCopilotCredentials(username, password);
      if (!jsonUser) {
        return NextResponse.json(
          { ok: false, error: "Invalid login." },
          { status: 401 }
        );
      }
      console.warn("[copilot/auth] COPILOT_USERS_JSON fallback hit", {
        username: jsonUser.username,
        tenantSlug: jsonUser.tenantSlug,
      });
      if (!agent) {
        agent = await findAgentByUsername(supabase, jsonUser.username);
      }
      if (!agent || agent.tenants?.slug !== jsonUser.tenantSlug) {
        return NextResponse.json(
          { ok: false, error: "Invalid login." },
          { status: 401 }
        );
      }
    } else {
      return NextResponse.json(
        { ok: false, error: "Invalid login." },
        { status: 401 }
      );
    }

    const tenantSlug = agent.tenants?.slug;
    if (!tenantSlug) {
      return NextResponse.json(
        { ok: false, error: "Invalid login." },
        { status: 401 }
      );
    }

    const token = createCopilotSessionToken({
      agentId: agent.id,
      tenantId: agent.tenant_id,
      tenantSlug,
    });

    await supabase
      .from("agents")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", agent.id);

    const response = NextResponse.json({
      ok: true,
      tenantSlug,
    });
    response.cookies.set(COPILOT_SESSION_COOKIE, token, copilotSessionCookieOptions());
    return response;
  } catch (error) {
    console.error("Copilot auth error:", error?.message);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message?.includes("COPILOT")
          ? "Login is not configured on the server."
          : "Unable to sign in.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COPILOT_SESSION_COOKIE, "", {
    ...copilotSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}

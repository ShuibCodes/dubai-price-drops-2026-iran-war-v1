import {
  consoleContext,
  jsonError,
  loadConsoleTenant,
  whatsappHealthy,
} from "@/lib/console/http";
import { cleanWaId } from "@/lib/copilot/agent-wa-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const [tenant, { data: agent, error: agentError }] = await Promise.all([
      loadConsoleTenant(supabase, session.tenantId),
        supabase
          .from("agents")
          .select("id, name, wa_id, brief_enabled, brief_time, tz")
          .eq("id", session.agentId)
          .eq("tenant_id", session.tenantId)
          .maybeSingle(),
      ]);
    if (agentError) throw new Error(agentError.message);

    return Response.json({
      number: tenant?.display_phone || null,
      whatsapp_healthy: whatsappHealthy(tenant),
      role: session.role,
      agent,
      billing: {
        plan: tenant?.billing_plan || null,
        status: tenant?.subscription_status || null,
        trial_started_at: tenant?.trial_started_at || null,
        trial_ends_at: tenant?.trial_ends_at || null,
        current_period_end: tenant?.current_period_end || null,
        cancel_at_period_end: Boolean(tenant?.cancel_at_period_end),
        canceled_at: tenant?.canceled_at || null,
        dedicated_account_manager: Boolean(tenant?.dedicated_account_manager),
        has_stripe_subscription: Boolean(tenant?.stripe_subscription_id),
      },
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

export async function PATCH(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const body = await request.json().catch(() => ({}));
    const patch = {};
    if (body.brief_enabled != null) patch.brief_enabled = Boolean(body.brief_enabled);
    if (body.brief_time != null && /^\d{2}:\d{2}$/.test(String(body.brief_time).slice(0, 5))) {
      patch.brief_time = String(body.brief_time).slice(0, 5);
    }
    if (body.tz != null) patch.tz = String(body.tz).trim() || "Asia/Dubai";
    if (body.wa_id !== undefined || body.phone !== undefined) {
      const rawPhone = body.wa_id !== undefined ? body.wa_id : body.phone;
      if (rawPhone === null || String(rawPhone).trim() === "") {
        patch.wa_id = null;
      } else {
        const waId = cleanWaId(rawPhone);
        if (!waId) {
          return jsonError("Phone number must contain between 6 and 20 digits.", 400);
        }
        const { data: conflict } = await supabase
          .from("agents")
          .select("id")
          .eq("wa_id", waId)
          .neq("id", session.agentId)
          .maybeSingle();
        if (conflict) {
          return jsonError(
            "This WhatsApp phone number is already registered to another agent.",
            409
          );
        }
        patch.wa_id = waId;
      }
    }
    if (!Object.keys(patch).length) return jsonError("Nothing to update.", 400);

    const { data, error } = await supabase
      .from("agents")
      .update(patch)
      .eq("id", session.agentId)
      .eq("tenant_id", session.tenantId)
      .select("id, name, wa_id, brief_enabled, brief_time, tz")
      .single();
    if (error) throw new Error(error.message);
    return Response.json({ agent: data });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

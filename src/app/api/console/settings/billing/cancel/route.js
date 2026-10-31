import {
  cancelStripeSubscription,
  isStripeConfigured,
  retrieveSubscription,
  syncTenantFromSubscription,
} from "@/lib/billing/stripe";
import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    if (session.role !== "admin") {
      return jsonError("Only the workspace admin can cancel billing.", 403);
    }

    const { data: tenant, error } = await supabase
      .from("tenants")
      .select(
        "id, slug, stripe_subscription_id, subscription_status, trial_ends_at, current_period_end, cancel_at_period_end, canceled_at"
      )
      .eq("id", session.tenantId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!tenant) return jsonError("Workspace not found.", 404);

    if (tenant.stripe_subscription_id && isStripeConfigured()) {
      const current = await retrieveSubscription(tenant.stripe_subscription_id);
      const updated = await cancelStripeSubscription(current);
      const synced = await syncTenantFromSubscription(supabase, updated, {
        tenantId: tenant.id,
      });
      return Response.json({
        ok: true,
        billing: synced,
      });
    }

    const now = new Date().toISOString();
    const isTrial =
      tenant.subscription_status === "trialing" || !tenant.subscription_status;

    const patch = isTrial
      ? {
          subscription_status: "canceled",
          cancel_at_period_end: false,
          canceled_at: now,
          outbound_paused: true,
        }
      : {
          cancel_at_period_end: true,
          canceled_at: now,
        };

    const { data: updated, error: updateError } = await supabase
      .from("tenants")
      .update(patch)
      .eq("id", tenant.id)
      .select(
        "id, slug, billing_plan, subscription_status, trial_started_at, trial_ends_at, current_period_end, cancel_at_period_end, canceled_at, dedicated_account_manager"
      )
      .single();

    if (updateError) throw new Error(updateError.message);
    return Response.json({ ok: true, billing: updated });
  } catch (error) {
    return jsonError(error?.message || "Could not cancel billing.", error?.status || 500);
  }
}

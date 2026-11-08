import { NextResponse } from "next/server";
import {
  INDIVIDUAL_BROKER_PLAN,
  INDIVIDUAL_BROKER_TRIAL_DAYS,
  buildPaymentLinkCheckoutUrl,
  createBrokerTrialCheckoutSession,
  getBrokerOfferAvailability,
  isStripeConfigured,
  retrieveCheckoutSessionWithSubscription,
  syncTenantFromSubscription,
} from "@/lib/billing/stripe";
import { oauthOrigin } from "@/lib/copilot/oauth-route";
import { getSession } from "@/lib/copilot/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Database is not configured." },
        { status: 500 }
      );
    }

    const sessionId = request.nextUrl.searchParams.get("session_id");
    const session = await getSession(request).catch(() => null);

    if (sessionId && session?.tenantId && isStripeConfigured()) {
      try {
        const checkoutSession =
          await retrieveCheckoutSessionWithSubscription(sessionId);
        const matchesTenant =
          checkoutSession?.client_reference_id === session.tenantId ||
          checkoutSession?.metadata?.tenant_id === session.tenantId;
        if (matchesTenant && checkoutSession?.subscription) {
          await syncTenantFromSubscription(supabase, checkoutSession.subscription, {
            tenantId: session.tenantId,
            checkoutSessionId: checkoutSession.id,
          });
        }
      } catch (err) {
        console.warn("[billing/checkout] session sync skipped:", err?.message);
      }
    }

    const offer = await getBrokerOfferAvailability(supabase);
    let account = null;
    if (session?.tenantId) {
      const [{ data: tenant }, { data: agent }] = await Promise.all([
        supabase
          .from("tenants")
          .select(
            "id, slug, name, billing_plan, subscription_status, trial_ends_at, current_period_end, cancel_at_period_end, dedicated_account_manager"
          )
          .eq("id", session.tenantId)
          .maybeSingle(),
        supabase
          .from("agents")
          .select(
            "id, name, email, wa_id, lead_sources, monthly_lead_volume, callback_speed, quiz_completed_at"
          )
          .eq("id", session.agentId)
          .maybeSingle(),
      ]);
      account = {
        tenantSlug: session.tenantSlug,
        tenant,
        agent,
      };
    }

    return NextResponse.json({
      offer,
      trialDays: INDIVIDUAL_BROKER_TRIAL_DAYS,
      priceAed: 250,
      stripeConfigured: isStripeConfigured(),
      account,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to load offer status." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json(
        { error: "Create your account first." },
        { status: 401 }
      );
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Database is not configured." },
        { status: 500 }
      );
    }

    const [{ data: tenant, error: tenantError }, { data: agent, error: agentError }] =
      await Promise.all([
        supabase
          .from("tenants")
          .select(
            "id, slug, name, stripe_customer_id, stripe_subscription_id, billing_plan, subscription_status"
          )
          .eq("id", session.tenantId)
          .maybeSingle(),
        supabase
          .from("agents")
          .select("id, name, email")
          .eq("id", session.agentId)
          .maybeSingle(),
      ]);

    if (tenantError || !tenant) {
      return NextResponse.json(
        { error: "Workspace not found." },
        { status: 404 }
      );
    }
    if (agentError || !agent) {
      return NextResponse.json({ error: "Broker not found." }, { status: 404 });
    }

    if (
      tenant.subscription_status === "trialing" ||
      tenant.subscription_status === "active"
    ) {
      return NextResponse.json({
        alreadyActive: true,
        redirectUrl: `/copilot/${encodeURIComponent(tenant.slug)}/welcome`,
      });
    }

    const offer = await getBrokerOfferAvailability(supabase);
    const alreadyCounted =
      tenant.billing_plan === INDIVIDUAL_BROKER_PLAN &&
      ["trialing", "active", "past_due"].includes(tenant.subscription_status);
    if (offer.soldOut && !alreadyCounted) {
      return NextResponse.json(
        {
          error:
            "All 5 spots for the AED 250/m offer have been claimed. Enquire for current availability.",
          soldOut: true,
        },
        { status: 409 }
      );
    }

    if (isStripeConfigured()) {
      const checkout = await createBrokerTrialCheckoutSession({
        origin: oauthOrigin(request),
        tenant,
        agent,
        customerId: tenant.stripe_customer_id || null,
      });

      await supabase
        .from("tenants")
        .update({
          stripe_checkout_session_id: checkout.id,
          billing_plan: INDIVIDUAL_BROKER_PLAN,
        })
        .eq("id", tenant.id);

      return NextResponse.json({
        url: checkout.url,
        sessionId: checkout.id,
      });
    }

    const now = new Date();
    const trialEnds = new Date(
      now.getTime() + INDIVIDUAL_BROKER_TRIAL_DAYS * 24 * 60 * 60 * 1000
    );
    await supabase
      .from("tenants")
      .update({
        billing_plan: INDIVIDUAL_BROKER_PLAN,
        subscription_status: "trialing",
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: trialEnds.toISOString(),
        cancel_at_period_end: false,
        canceled_at: null,
        dedicated_account_manager: true,
        outbound_paused: false,
      })
      .eq("id", tenant.id);

    return NextResponse.json({
      url: buildPaymentLinkCheckoutUrl({ tenant, agent }),
      paymentLinkFallback: true,
    });
  } catch (error) {
    console.error("[billing/checkout]", error?.message);
    return NextResponse.json(
      { error: error?.message || "Could not start Stripe Checkout." },
      { status: error?.status || 500 }
    );
  }
}

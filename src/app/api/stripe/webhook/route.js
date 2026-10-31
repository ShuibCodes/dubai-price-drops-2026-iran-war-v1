import { NextResponse } from "next/server";
import {
  retrieveSubscription,
  syncTenantFromSubscription,
  verifyStripeWebhookSignature,
} from "@/lib/billing/stripe";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveSubscriptionFromInvoice(invoice) {
  const sub =
    invoice?.subscription ||
    invoice?.parent?.subscription_details?.subscription ||
    null;
  if (!sub) return null;
  if (typeof sub === "object" && sub.id) return sub;
  return retrieveSubscription(String(sub));
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");
    const event = verifyStripeWebhookSignature(rawBody, signature);

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Database is not configured." },
        { status: 500 }
      );
    }

    const type = event?.type;
    const obj = event?.data?.object;

    if (
      type === "checkout.session.completed" ||
      type === "checkout.session.async_payment_succeeded"
    ) {
      const subId =
        typeof obj?.subscription === "string"
          ? obj.subscription
          : obj?.subscription?.id;
      const tenantId =
        obj?.client_reference_id || obj?.metadata?.tenant_id || null;
      if (subId) {
        const subscription = await retrieveSubscription(subId);
        await syncTenantFromSubscription(supabase, subscription, {
          tenantId,
          checkoutSessionId: obj?.id || null,
        });
      }
    } else if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      await syncTenantFromSubscription(supabase, obj, {
        tenantId: obj?.metadata?.tenant_id || null,
      });
    } else if (
      type === "invoice.paid" ||
      type === "invoice.payment_failed"
    ) {
      const subscription = await resolveSubscriptionFromInvoice(obj);
      if (subscription) {
        await syncTenantFromSubscription(supabase, subscription, {
          tenantId: subscription?.metadata?.tenant_id || null,
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe/webhook]", error?.message);
    return NextResponse.json(
      { error: error?.message || "Webhook failed." },
      { status: error?.status || 400 }
    );
  }
}

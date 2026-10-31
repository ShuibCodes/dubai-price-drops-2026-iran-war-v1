import { createHmac, timingSafeEqual } from "crypto";

export const INDIVIDUAL_BROKER_PRODUCT_ID = "prod_VXM5z1TynHHX2M";
export const INDIVIDUAL_BROKER_PRICE_ID =
  process.env.STRIPE_INDIVIDUAL_BROKER_PRICE_ID ||
  "price_1UWHMtE05JYH4qkK8uvDT3hW";

export const INDIVIDUAL_BROKER_PAYMENT_LINK =
  process.env.STRIPE_INDIVIDUAL_BROKER_PAYMENT_LINK ||
  "https://buy.stripe.com/eVq4gzbTr97UfdRcdh4800a";

export const INDIVIDUAL_BROKER_PLAN = "individual_broker_250";
export const INDIVIDUAL_BROKER_TRIAL_DAYS = 5;
export const INDIVIDUAL_BROKER_SEAT_LIMIT = 5;

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const WEBHOOK_TOLERANCE_SEC = 300;

export function getStripeSecretKey() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (
    !key ||
    key.toLowerCase() === "your_stripe_secret_key" ||
    (!key.startsWith("sk_") && !key.startsWith("rk_"))
  ) {
    return null;
  }
  return key;
}

export function isStripeConfigured() {
  return Boolean(getStripeSecretKey());
}

export function buildPaymentLinkCheckoutUrl({ tenant, agent }) {
  const url = new URL(INDIVIDUAL_BROKER_PAYMENT_LINK);
  if (tenant?.id) {
    url.searchParams.set("client_reference_id", String(tenant.id));
  }
  if (agent?.email) {
    url.searchParams.set("prefilled_email", String(agent.email));
  }
  return url.toString();
}

function appendFormPairs(params, prefix, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      appendFormPairs(params, `${prefix}[${index}]`, item);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      appendFormPairs(params, `${prefix}[${key}]`, nested);
    }
    return;
  }
  params.append(prefix, String(value));
}

export function toStripeFormBody(data = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    appendFormPairs(params, key, value);
  }
  return params;
}

export async function stripeRequest(path, { method = "GET", body, query } = {}) {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    const error = new Error(
      "Stripe is not configured on this server (missing STRIPE_SECRET_KEY)."
    );
    error.status = 503;
    throw error;
  }

  const url = new URL(
    path.replace(/^\/+/, ""),
    `${STRIPE_API_BASE}/`
  );
  if (query && typeof query === "object") {
    const qs = toStripeFormBody(query);
    for (const [key, value] of qs.entries()) {
      url.searchParams.append(key, value);
    }
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };
  let encodedBody;
  if (body && method !== "GET") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    encodedBody = toStripeFormBody(body).toString();
  }

  const response = await fetch(url, {
    method,
    headers,
    body: encodedBody,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message || `Stripe request failed (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error?.code || null;
    throw error;
  }
  return payload;
}

export function integrationIdentifier() {
  return "agentzero_broker_trial_k9mwpqrx";
}

export function unixToIso(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

export async function countClaimedBrokerOfferSeats(supabase) {
  const { count, error } = await supabase
    .from("tenants")
    .select("id", { count: "exact", head: true })
    .eq("billing_plan", INDIVIDUAL_BROKER_PLAN)
    .in("subscription_status", ["trialing", "active", "past_due"]);
  if (error) {
    if (/billing_plan|subscription_status/i.test(String(error.message || ""))) {
      return 0;
    }
    throw new Error(`Could not check offer availability: ${error.message}`);
  }
  return count || 0;
}

export async function getBrokerOfferAvailability(supabase) {
  const claimed = await countClaimedBrokerOfferSeats(supabase);
  const remaining = Math.max(0, INDIVIDUAL_BROKER_SEAT_LIMIT - claimed);
  return {
    limit: INDIVIDUAL_BROKER_SEAT_LIMIT,
    claimed,
    remaining,
    soldOut: remaining < 1,
  };
}

export async function createBrokerTrialCheckoutSession({
  origin,
  tenant,
  agent,
  customerId,
}) {
  const baseUrl = String(origin || "").replace(/\/+$/, "");
  const tenantSlug = encodeURIComponent(tenant.slug);
  const successUrl = `${baseUrl}/copilot/${tenantSlug}/welcome?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${baseUrl}/get-started?canceled=1`;

  const metadata = {
    tenant_id: String(tenant.id),
    tenant_slug: String(tenant.slug),
    agent_id: String(agent.id),
    billing_plan: INDIVIDUAL_BROKER_PLAN,
    offer: "next_5_brokers",
  };

  const sessionBody = {
    mode: "subscription",
    line_items: [{ price: INDIVIDUAL_BROKER_PRICE_ID, quantity: 1 }],
    payment_method_collection: "always",
    client_reference_id: String(tenant.id),
    integration_identifier: integrationIdentifier(),
    metadata,
    subscription_data: {
      trial_period_days: INDIVIDUAL_BROKER_TRIAL_DAYS,
      description:
        "AgentZero Individual Broker — 5-day free trial, then AED 250/month. Dedicated account manager included (next 5 brokers only).",
      metadata,
    },
    custom_text: {
      submit: {
        message:
          "Due today: AED 0. In 5 days you'll be charged AED 250/month unless cancelled from Settings. Dedicated account manager included (next 5 brokers only).",
      },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  };

  if (customerId) {
    sessionBody.customer = customerId;
  } else if (agent?.email) {
    sessionBody.customer_email = agent.email;
  }

  return stripeRequest("/checkout/sessions", {
    method: "POST",
    body: sessionBody,
  });
}

export async function retrieveCheckoutSessionWithSubscription(sessionId) {
  return stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    query: { expand: ["subscription"] },
  });
}

export async function retrieveSubscription(subscriptionId) {
  return stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export async function cancelStripeSubscription(subscription) {
  const id = typeof subscription === "string" ? subscription : subscription?.id;
  const status = typeof subscription === "object" ? subscription?.status : null;
  if (!id) throw new Error("Missing subscription ID.");

  const current =
    status != null ? subscription : await retrieveSubscription(id);

  // During the 5-day trial, cancel immediately so the card is never charged on day 5.
  if (current.status === "trialing" || current.status === "incomplete") {
    return stripeRequest(`/subscriptions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  // Once a paid month is active, stop renewal at period end so they keep what they paid for.
  return stripeRequest(`/subscriptions/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { cancel_at_period_end: true },
  });
}

export function subscriptionPatchFromStripe(subscription, extra = {}) {
  const status = String(subscription?.status || "").trim() || null;
  const priceId =
    subscription?.items?.data?.[0]?.price?.id ||
    subscription?.plan?.id ||
    INDIVIDUAL_BROKER_PRICE_ID;
  const activeOrTrial = status === "trialing" || status === "active";

  const patch = {
    stripe_customer_id:
      typeof subscription?.customer === "string"
        ? subscription.customer
        : subscription?.customer?.id || undefined,
    stripe_subscription_id: subscription?.id || undefined,
    stripe_price_id: priceId || undefined,
    billing_plan:
      subscription?.metadata?.billing_plan || INDIVIDUAL_BROKER_PLAN,
    subscription_status: status,
    trial_started_at: unixToIso(subscription?.trial_start),
    trial_ends_at: unixToIso(subscription?.trial_end),
    current_period_end: unixToIso(
      subscription?.current_period_end ||
        subscription?.items?.data?.[0]?.current_period_end ||
        subscription?.trial_end
    ),
    cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
    canceled_at: unixToIso(subscription?.canceled_at),
    dedicated_account_manager: true,
    ...extra,
  };

  if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
    patch.outbound_paused = true;
  } else if (activeOrTrial) {
    patch.outbound_paused = false;
  }

  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) delete patch[key];
  }
  return patch;
}

export async function syncTenantFromSubscription(
  supabase,
  subscription,
  { tenantId = null, checkoutSessionId = null } = {}
) {
  if (!subscription?.id) return null;
  const patch = subscriptionPatchFromStripe(
    subscription,
    checkoutSessionId ? { stripe_checkout_session_id: checkoutSessionId } : {}
  );

  let targetTenantId =
    tenantId || subscription?.metadata?.tenant_id || null;

  if (!targetTenantId) {
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;
    const { data: match } = await supabase
      .from("tenants")
      .select("id")
      .or(
        [
          `stripe_subscription_id.eq.${subscription.id}`,
          customerId ? `stripe_customer_id.eq.${customerId}` : null,
        ]
          .filter(Boolean)
          .join(",")
      )
      .maybeSingle();
    targetTenantId = match?.id || null;
  }

  if (!targetTenantId) return null;

  const { data, error } = await supabase
    .from("tenants")
    .update(patch)
    .eq("id", targetTenantId)
    .select(
      "id, slug, billing_plan, subscription_status, trial_started_at, trial_ends_at, current_period_end, cancel_at_period_end, canceled_at, dedicated_account_manager"
    )
    .maybeSingle();
  if (error) throw new Error(`Failed to update tenant billing: ${error.message}`);
  return data;
}

export function verifyStripeWebhookSignature(rawBody, signatureHeader) {
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret || secret === "your_stripe_webhook_secret") {
    const error = new Error("STRIPE_WEBHOOK_SECRET is not configured.");
    error.status = 503;
    throw error;
  }
  if (!signatureHeader) {
    const error = new Error("Missing Stripe-Signature header.");
    error.status = 400;
    throw error;
  }

  const parts = String(signatureHeader)
    .split(",")
    .map((item) => item.trim());
  const timestamp = parts
    .find((item) => item.startsWith("t="))
    ?.slice(2);
  const signatures = parts
    .filter((item) => item.startsWith("v1="))
    .map((item) => item.slice(3))
    .filter(Boolean);

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !signatures.length) {
    const error = new Error("Malformed Stripe-Signature header.");
    error.status = 400;
    throw error;
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (age > WEBHOOK_TOLERANCE_SEC) {
    const error = new Error("Stripe webhook timestamp is outside tolerance.");
    error.status = 400;
    throw error;
  }

  const signedPayload = `${ts}.${rawBody}`;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex"),
    "utf8"
  );

  const matched = signatures.some((sig) => {
    const candidate = Buffer.from(sig, "utf8");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  });

  if (!matched) {
    const error = new Error("Invalid Stripe webhook signature.");
    error.status = 400;
    throw error;
  }

  return JSON.parse(rawBody);
}

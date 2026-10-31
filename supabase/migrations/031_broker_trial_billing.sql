-- Individual broker trial & subscription billing (AED 250/month after 5 days,
-- capped at the next 5 brokers) plus post-checkout quiz answers.

alter table tenants
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_price_id text,
  add column if not exists billing_plan text,
  add column if not exists subscription_status text,
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists canceled_at timestamptz,
  add column if not exists dedicated_account_manager boolean not null default false;

create unique index if not exists tenants_stripe_customer_id_unique
  on tenants (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists tenants_stripe_subscription_id_unique
  on tenants (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists tenants_billing_plan_status_idx
  on tenants (billing_plan, subscription_status);

alter table agents
  add column if not exists lead_sources text[] not null default '{}',
  add column if not exists monthly_lead_volume text,
  add column if not exists callback_speed text,
  add column if not exists quiz_completed_at timestamptz;

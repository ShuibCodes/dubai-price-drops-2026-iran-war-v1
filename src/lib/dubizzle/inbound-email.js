import { randomBytes } from "crypto";

export const DEFAULT_INBOUND_DOMAIN = "leads.agentzero.ae";
const TOKEN_LEN = 6;
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const MAX_ALLOCATE_ATTEMPTS = 16;

export function inboundEmailDomain() {
  const raw = String(process.env.INBOUND_EMAIL_DOMAIN || DEFAULT_INBOUND_DOMAIN)
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  return raw || DEFAULT_INBOUND_DOMAIN;
}

export function sanitizeTenantSlug(slug) {
  const safe = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "tenant";
}

export function randomInboundToken(length = TOKEN_LEN, rng = randomBytes) {
  const bytes = rng(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALNUM[bytes[i] % ALNUM.length];
  }
  return out;
}

export function generateInboundEmail(slug, { domain, token } = {}) {
  const host = String(domain || inboundEmailDomain())
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  const local = `${sanitizeTenantSlug(slug)}-${token || randomInboundToken()}`;
  return `${local}@${host}`;
}

export function normalizeInboundAddress(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const angle = raw.match(/<([^>]+)>/);
  return (angle ? angle[1] : raw).trim().toLowerCase();
}

export async function isEmailRetired(supabase, email) {
  const address = normalizeInboundAddress(email);
  if (!address) return false;
  const { data, error } = await supabase
    .from("retired_inbound_emails")
    .select("email")
    .eq("email", address)
    .maybeSingle();
  if (error) throw new Error(`Retired email lookup failed: ${error.message}`);
  return Boolean(data?.email);
}

async function isEmailTaken(supabase, email) {
  const address = normalizeInboundAddress(email);
  const { data, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("inbound_email", address)
    .maybeSingle();
  if (error) throw new Error(`Inbound email lookup failed: ${error.message}`);
  return Boolean(data?.id);
}

async function loadTenant(supabase, tenantId) {
  const id = String(tenantId || "").trim();
  if (!id) throw new Error("tenantId is required");
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, inbound_email")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  if (!data) throw new Error("Tenant not found");
  return data;
}

async function assignGeneratedAddress(
  supabase,
  tenant,
  { excludeEmail, createToken } = {}
) {
  for (let attempt = 0; attempt < MAX_ALLOCATE_ATTEMPTS; attempt += 1) {
    const token = createToken ? createToken() : undefined;
    const email = generateInboundEmail(tenant.slug, { token });
    if (excludeEmail && email === excludeEmail) continue;
    if (await isEmailRetired(supabase, email)) continue;
    if (await isEmailTaken(supabase, email)) continue;

    const { data, error } = await supabase
      .from("tenants")
      .update({ inbound_email: email })
      .eq("id", tenant.id)
      .select("id, slug, inbound_email")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") continue;
      throw new Error(`Inbound email assign failed: ${error.message}`);
    }
    if (data?.inbound_email) return data.inbound_email;
  }
  throw new Error("Could not allocate a unique inbound email");
}

/** Return existing address, or allocate one. Never uses another tenant. */
export async function allocateInboundEmail(supabase, tenantId, options = {}) {
  const tenant = await loadTenant(supabase, tenantId);
  if (tenant.inbound_email) return tenant.inbound_email;
  return assignGeneratedAddress(supabase, tenant, options);
}

/**
 * Retire the current address (never reused) and assign a new one.
 * No-ops the retire insert if there was no previous address.
 */
export async function retireInboundEmail(supabase, tenantId, options = {}) {
  const tenant = await loadTenant(supabase, tenantId);
  const previous = normalizeInboundAddress(tenant.inbound_email);

  if (previous) {
    const { error: retireError } = await supabase
      .from("retired_inbound_emails")
      .insert({ email: previous, tenant_id: tenant.id });
    if (retireError && retireError.code !== "23505") {
      throw new Error(`Inbound email retire failed: ${retireError.message}`);
    }
  }

  return assignGeneratedAddress(supabase, tenant, {
    ...options,
    excludeEmail: previous,
  });
}

export async function listTenantsMissingInboundEmail(supabase) {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, inbound_email");
  if (error) throw new Error(`Tenant list failed: ${error.message}`);
  return (data || []).filter((row) => !normalizeInboundAddress(row.inbound_email));
}

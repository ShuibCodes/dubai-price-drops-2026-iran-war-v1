import {
  isEmailRetired,
  normalizeInboundAddress,
} from "@/lib/dubizzle/inbound-email";

export function collectRecipientAddresses(data = {}) {
  const bags = [data.to, data.cc, data.received_for, data.recipient];
  const found = [];
  const seen = new Set();
  for (const bag of bags) {
    const list = Array.isArray(bag) ? bag : bag ? [bag] : [];
    for (const item of list) {
      const address = normalizeInboundAddress(item);
      if (!address || seen.has(address)) continue;
      seen.add(address);
      found.push(address);
    }
  }
  return found;
}

/**
 * Resolve the tenant that owns this inbound address.
 * Returns null for unknown or retired addresses — never a fallback tenant.
 */
export async function findTenantByInboundEmail(supabase, email) {
  const address = normalizeInboundAddress(email);
  if (!address) return null;

  if (await isEmailRetired(supabase, address)) {
    return { retired: true, tenant: null, inboundEmail: address };
  }

  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, inbound_email")
    .eq("inbound_email", address)
    .maybeSingle();
  if (error) throw new Error(`Tenant inbound lookup failed: ${error.message}`);
  if (!data?.id) {
    return { retired: false, tenant: null, inboundEmail: address };
  }
  return { retired: false, tenant: data, inboundEmail: address };
}

export async function resolveTenantFromRecipients(supabase, data) {
  const recipients = collectRecipientAddresses(data);
  for (const address of recipients) {
    const result = await findTenantByInboundEmail(supabase, address);
    if (result.retired) {
      return { ...result, recipients };
    }
    if (result.tenant) {
      return { ...result, recipients };
    }
  }
  return {
    retired: false,
    tenant: null,
    inboundEmail: recipients[0] || null,
    recipients,
  };
}

function stripToDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Normalize Pixxi / UAE phone numbers to E.164 (+9715XXXXXXXX).
 * Returns null if the input cannot be normalized.
 */
export function normalizePhone(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith("+");
  let digits = stripToDigits(trimmed);
  if (!digits) return null;

  // Pixxi: 971 + stray leading 0 + subscriber (e.g. 9710554229317)
  if (digits.startsWith("9710") && digits.length >= 13) {
    digits = `971${digits.slice(4)}`;
  }

  // UAE local with leading 0 (05XXXXXXXX)
  if (digits.startsWith("0") && digits.length >= 10) {
    digits = `971${digits.slice(1)}`;
  }

  // Bare UAE mobile (5XXXXXXXX)
  if (/^5\d{8}$/.test(digits)) {
    digits = `971${digits}`;
  }

  // Already has country code 971
  if (digits.startsWith("971") && digits.length >= 11) {
    return `+${digits}`;
  }

  // Valid E.164 that was passed with +
  if (hadPlus && digits.length >= 10) {
    return `+${digits}`;
  }

  // Other international numbers with enough digits
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

/** Digits-only form for wa_id / Graph API `to` fields. */
export function phoneToWaId(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return normalized.replace(/\D/g, "");
}

export function maskPhone(phone) {
  const normalized = normalizePhone(phone) || String(phone || "");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  const prefix = digits.startsWith("971") ? "+971" : `+${digits.slice(0, Math.min(3, digits.length - 3))}`;
  const suffix = digits.slice(-3);
  return `${prefix}******${suffix}`;
}

export function buildPropertyInterest({ rooms, house_type, community, budget } = {}) {
  const parts = [];
  const roomsStr = String(rooms || "").trim();
  if (roomsStr) parts.push(`${roomsStr} bed`);
  const houseType = String(house_type || "").trim();
  if (houseType) parts.push(houseType);
  const communityStr = String(community || "").trim();
  if (communityStr) parts.push(communityStr);
  const budgetStr = String(budget || "").trim();
  if (budgetStr) parts.push(`around ${budgetStr}`);
  if (!parts.length) return "your property enquiry";
  return parts.join(", ");
}

export function resolveLeadSource({ client_source, custom_client_source } = {}) {
  const source = String(client_source || "").trim();
  if (source) return source;
  const custom = String(custom_client_source || "").trim();
  if (custom) return custom;
  return "one of the property portals";
}

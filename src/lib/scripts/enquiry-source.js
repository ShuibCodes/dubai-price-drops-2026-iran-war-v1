/**
 * Genuine inbound enquiry vs purchased/imported list.
 * Allowlist only — unknown sources stay neutral so we never claim a prior enquiry.
 *
 * Live leads.source classified inbound: "ghl", "Meta Instant Form — …"
 * Everything else live (Purchased list, condo-city building dumps, null) is not.
 */
export function isInboundEnquirySource(source) {
  const raw = String(source || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "purchased list" || raw.includes("purchased list")) return false;
  // Dial fallback when source is missing — not proof of an enquiry.
  if (raw === "one of the property portals") return false;

  if (raw === "meta-instant-form" || raw.includes("meta instant form")) return true;
  if (raw === "ghl" || raw.startsWith("ghl-") || raw.startsWith("ghl ")) return true;
  if (raw === "pixxi-inbound" || raw.includes("property finder") || raw.includes("propertyfinder")) {
    return true;
  }
  if (raw.includes("bayut") || raw.includes("dubizzle")) return true;
  if (raw.includes("portal")) return true;
  if (raw === "inbound") return true;
  return false;
}

/** Suffix for the identity line. Empty string when we must not claim an enquiry. */
export function enquiryClauseForSource(source) {
  if (!isInboundEnquirySource(source)) return "";
  const spoken = String(source || "").trim();
  if (!spoken) return "";
  return ` who made a property enquiry via ${spoken}`;
}

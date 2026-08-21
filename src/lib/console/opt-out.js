const OPT_OUT_RE =
  /\b(don'?t (call|contact)|do not call|stop calling|opt[ -]?out|remove me|never call|dnc)\b/i;

export function transcriptLooksLikeOptOut(text) {
  return OPT_OUT_RE.test(String(text || ""));
}

export function qualificationLooksLikeOptOut(qualification = {}, details = {}) {
  if (qualification?.opted_out === true) return true;
  if (details?.structuredData?.opted_out === true) return true;
  if (qualification?.outcome === "not_interested" && transcriptLooksLikeOptOut(details.transcript)) {
    return true;
  }
  return transcriptLooksLikeOptOut(details.transcript);
}

export async function markLeadOptedOut(supabase, { tenantId, leadId }) {
  if (!tenantId || !leadId) return false;
  const { data, error } = await supabase
    .from("leads")
    .update({
      opted_out: true,
      opted_out_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .eq("opted_out", false)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Opt-out update failed: ${error.message}`);
  return Boolean(data);
}

export function assertLeadCallable(lead) {
  if (lead?.opted_out) {
    throw new Error("Lead has opted out");
  }
}

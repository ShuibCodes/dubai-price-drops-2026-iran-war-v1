const CALLED_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

function sinceIso(ms) {
  return new Date(Date.now() - ms).toISOString();
}

export async function previewRunMatch(supabase, {
  tenantId,
  sourceType,
  areas = [],
  bedrooms,
  calledWithinDays = 7,
}) {
  const exclusions = [];
  const source = String(sourceType || "whatsapp");

  if (source === "whatsapp") {
    const { data: inbox, error } = await supabase
      .from("jarvis_leads")
      .select("id, last_message_at")
      .eq("tenant_id", tenantId);
    if (error) throw new Error(`Inbox match failed: ${error.message}`);
    const pool = inbox || [];
    const calledSince = sinceIso((Number(calledWithinDays) || 7) * 24 * 60 * 60 * 1000);
    const ids = pool.map((row) => row.id);
    let recentlyCalled = 0;
    if (ids.length) {
      const { data: recent } = await supabase
        .from("calls")
        .select("jarvis_lead_id")
        .eq("tenant_id", tenantId)
        .in("jarvis_lead_id", ids.slice(0, 200))
        .gte("created_at", calledSince);
      recentlyCalled = new Set((recent || []).map((row) => row.jarvis_lead_id)).size;
    }
    if (recentlyCalled) {
      exclusions.push({
        n: recentlyCalled,
        reason: "called in the last 7 days",
      });
    }
    return {
      matched: Math.max(0, pool.length - recentlyCalled),
      pool: pool.length,
      exclusions,
    };
  }

  let query = supabase
    .from("leads")
    .select("id, opted_out, areas, bedrooms, last_message_at")
    .eq("tenant_id", tenantId)
    .not("source", "is", null);

  const { data: rows, error } = await query;
  if (error) throw new Error(`Lead match failed: ${error.message}`);
  const all = rows || [];
  const optedOut = all.filter((row) => row.opted_out).length;
  if (optedOut) exclusions.push({ n: optedOut, reason: "opted out" });

  let usable = all.filter((row) => !row.opted_out);

  const areaFilters = (areas || []).map((a) => String(a).trim()).filter(Boolean);
  if (areaFilters.length) {
    const before = usable.length;
    usable = usable.filter((row) => {
      const have = Array.isArray(row.areas) ? row.areas : [];
      return areaFilters.some((area) =>
        have.some((h) => String(h).toLowerCase() === area.toLowerCase())
      );
    });
    const dropped = before - usable.length;
    if (dropped) exclusions.push({ n: dropped, reason: "outside selected areas" });
  }

  const beds = String(bedrooms || "").trim();
  if (beds) {
    const before = usable.length;
    usable = usable.filter(
      (row) => String(row.bedrooms || "").toLowerCase() === beds.toLowerCase()
    );
    const dropped = before - usable.length;
    if (dropped) exclusions.push({ n: dropped, reason: `not ${beds}` });
  }

  const ids = usable.map((row) => row.id);
  let recentlyCalled = 0;
  if (ids.length) {
    const { data: recent } = await supabase
      .from("calls")
      .select("lead_id")
      .eq("tenant_id", tenantId)
      .in("lead_id", ids.slice(0, 500))
      .gte("created_at", sinceIso((Number(calledWithinDays) || 7) * CALLED_WITHIN_MS / 7));
    recentlyCalled = new Set((recent || []).map((row) => row.lead_id)).size;
  }
  if (recentlyCalled) {
    exclusions.push({ n: recentlyCalled, reason: "called in the last 7 days" });
  }

  return {
    matched: Math.max(0, usable.length - recentlyCalled),
    pool: all.length,
    exclusions,
  };
}

export async function selectRunLeadIds(supabase, {
  tenantId,
  sourceType,
  areas = [],
  bedrooms,
  calledWithinDays = 7,
  limit,
}) {
  const source = String(sourceType || "whatsapp");
  const cap = Math.max(1, Number(limit) || 200);
  const calledSince = sinceIso((Number(calledWithinDays) || 7) * 24 * 60 * 60 * 1000);

  if (source === "whatsapp") {
    const { data: inbox, error } = await supabase
      .from("jarvis_leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(800);
    if (error) throw new Error(`Inbox select failed: ${error.message}`);
    const ids = (inbox || []).map((row) => row.id);
    const { data: recent } = ids.length
      ? await supabase
          .from("calls")
          .select("jarvis_lead_id")
          .eq("tenant_id", tenantId)
          .in("jarvis_lead_id", ids)
          .gte("created_at", calledSince)
      : { data: [] };
    const skip = new Set((recent || []).map((row) => row.jarvis_lead_id));
    return {
      jarvisLeadIds: ids.filter((id) => !skip.has(id)).slice(0, cap),
      leadIds: [],
    };
  }

  const { data: rows, error } = await supabase
    .from("leads")
    .select("id, opted_out, areas, bedrooms")
    .eq("tenant_id", tenantId)
    .eq("opted_out", false)
    .not("source", "is", null)
    .limit(2000);
  if (error) throw new Error(`Lead select failed: ${error.message}`);

  const areaFilters = (areas || []).map((a) => String(a).trim()).filter(Boolean);
  const beds = String(bedrooms || "").trim();
  let usable = rows || [];
  if (areaFilters.length) {
    usable = usable.filter((row) => {
      const have = Array.isArray(row.areas) ? row.areas : [];
      return areaFilters.some((area) =>
        have.some((h) => String(h).toLowerCase() === area.toLowerCase())
      );
    });
  }
  if (beds) {
    usable = usable.filter(
      (row) => String(row.bedrooms || "").toLowerCase() === beds.toLowerCase()
    );
  }

  const ids = usable.map((row) => row.id);
  const { data: recent } = ids.length
    ? await supabase
        .from("calls")
        .select("lead_id")
        .eq("tenant_id", tenantId)
        .in("lead_id", ids.slice(0, 500))
        .gte("created_at", calledSince)
    : { data: [] };
  const skip = new Set((recent || []).map((row) => row.lead_id));
  return {
    leadIds: ids.filter((id) => !skip.has(id)).slice(0, cap),
    jarvisLeadIds: [],
  };
}

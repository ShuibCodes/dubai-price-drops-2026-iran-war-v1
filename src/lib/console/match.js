export async function previewRunMatch(supabase, {
  tenantId,
  sourceType,
  areas = [],
  bedrooms,
  listName = "",
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
    return {
      matched: pool.length,
      pool: pool.length,
      exclusions,
    };
  }

  let query = supabase
    .from("leads")
    .select("id, opted_out, areas, bedrooms, last_message_at, source")
    .eq("tenant_id", tenantId)
    .not("source", "is", null);

  const named = String(listName || "").trim();
  if (named) query = query.eq("source", named);

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

  return {
    matched: usable.length,
    pool: all.length,
    exclusions,
  };
}

export async function selectRunLeadIds(supabase, {
  tenantId,
  sourceType,
  areas = [],
  bedrooms,
  listName = "",
  limit,
}) {
  const source = String(sourceType || "whatsapp");
  const cap = Math.max(1, Number(limit) || 200);

  if (source === "whatsapp") {
    const { data: inbox, error } = await supabase
      .from("jarvis_leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(800);
    if (error) throw new Error(`Inbox select failed: ${error.message}`);
    const ids = (inbox || []).map((row) => row.id);
    return {
      jarvisLeadIds: ids.slice(0, cap),
      leadIds: [],
    };
  }

  const named = String(listName || "").trim();
  let query = supabase
    .from("leads")
    .select("id, opted_out, areas, bedrooms")
    .eq("tenant_id", tenantId)
    .eq("opted_out", false)
    .not("source", "is", null)
    .limit(2000);
  if (named) query = query.eq("source", named);

  const { data: rows, error } = await query;
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

  return {
    leadIds: usable.map((row) => row.id).slice(0, cap),
    jarvisLeadIds: [],
  };
}

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

const LEAD_PAGE = 1000;
/** Safety stop so a broken pager cannot load the whole tenant. */
const LEAD_HARD_MAX = 20000;

function positiveLimit(limit) {
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function matchesRunFilters(row, areaFilters, beds) {
  if (areaFilters.length) {
    const have = Array.isArray(row.areas) ? row.areas : [];
    const inArea = areaFilters.some((area) =>
      have.some((h) => String(h).toLowerCase() === area.toLowerCase())
    );
    if (!inArea) return false;
  }
  if (beds && String(row.bedrooms || "").toLowerCase() !== beds.toLowerCase()) {
    return false;
  }
  return true;
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
  const cap = positiveLimit(limit);

  if (source === "whatsapp") {
    const inboxCap = cap ?? 200;
    const { data: inbox, error } = await supabase
      .from("jarvis_leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(800);
    if (error) throw new Error(`Inbox select failed: ${error.message}`);
    const ids = (inbox || []).map((row) => row.id);
    return {
      jarvisLeadIds: ids.slice(0, inboxCap),
      leadIds: [],
    };
  }

  const named = String(listName || "").trim();
  const areaFilters = (areas || []).map((a) => String(a).trim()).filter(Boolean);
  const beds = String(bedrooms || "").trim();
  const want = cap ?? LEAD_HARD_MAX;
  const usable = [];

  for (let from = 0; usable.length < want; from += LEAD_PAGE) {
    let query = supabase
      .from("leads")
      .select("id, areas, bedrooms")
      .eq("tenant_id", tenantId)
      .eq("opted_out", false)
      .not("source", "is", null)
      .order("id", { ascending: true })
      .range(from, from + LEAD_PAGE - 1);
    if (named) query = query.eq("source", named);

    const { data: rows, error } = await query;
    if (error) throw new Error(`Lead select failed: ${error.message}`);
    const page = rows || [];
    for (const row of page) {
      if (!matchesRunFilters(row, areaFilters, beds)) continue;
      usable.push(row.id);
      if (usable.length >= want) break;
    }
    if (page.length < LEAD_PAGE) break;
  }

  return {
    leadIds: usable,
    jarvisLeadIds: [],
  };
}

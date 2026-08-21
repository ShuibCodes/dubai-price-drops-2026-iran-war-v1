import { normalizePhone, phoneToWaId } from "@/lib/leads/normalize";

export function normalizeListName(raw) {
  const name = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (name.length < 2) {
    const error = new Error("Name the list so you can call it later from WhatsApp.");
    error.status = 400;
    throw error;
  }
  return name;
}

export async function upsertListContacts(supabase, tenantId, { name, contacts }) {
  const listName = normalizeListName(name);
  const rows = Array.isArray(contacts) ? contacts : [];
  const ids = [];
  let skipped = 0;

  for (const contact of rows) {
    const phone = normalizePhone(contact.phone || contact.wa_id);
    const waId = phoneToWaId(phone);
    if (!waId) {
      skipped += 1;
      continue;
    }
    const now = new Date().toISOString();
    const pushName = String(contact.name || "").trim() || null;
    const { data: existing } = await supabase
      .from("leads")
      .select("id, opted_out, push_name")
      .eq("tenant_id", tenantId)
      .eq("wa_id", waId)
      .maybeSingle();
    if (existing?.opted_out) {
      skipped += 1;
      continue;
    }
    if (existing) {
      const { error } = await supabase
        .from("leads")
        .update({
          source: listName,
          push_name: pushName || existing.push_name || null,
          last_message_at: now,
        })
        .eq("id", existing.id);
      if (error) throw new Error(`Lead update failed: ${error.message}`);
      ids.push(existing.id);
      continue;
    }
    const { data, error } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenantId,
        wa_id: waId,
        push_name: pushName,
        source: listName,
        first_seen: now,
        last_message_at: now,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Lead insert failed: ${error.message}`);
    ids.push(data.id);
  }

  return { name: listName, saved: ids.length, skipped, leadIds: ids };
}

export async function listSavedLists(supabase, tenantId) {
  const { data, error } = await supabase
    .from("leads")
    .select("source")
    .eq("tenant_id", tenantId)
    .eq("opted_out", false)
    .not("source", "is", null)
    .limit(8000);
  if (error) throw new Error(`List lookup failed: ${error.message}`);

  const counts = new Map();
  for (const row of data || []) {
    const key = String(row.source || "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

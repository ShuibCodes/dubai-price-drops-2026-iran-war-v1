import { normalizePhone, phoneToWaId } from "@/lib/leads/normalize";

export function foldListKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
}

function stripListCommand(text) {
  return foldListKey(text)
    .replace(/^(please |can you |could you |lets |let's )/, "")
    .replace(
      /^(call|dial|queue|start|ring)\s+(everyone on |everyone in |people on |people in )?/,
      ""
    )
    .replace(/^(my |the |our |this )/, "")
    .replace(/\s+with\b.+$/, "")
    .replace(/\s+using\b.+$/, "")
    .replace(/\s+script\b.*$/, "")
    .trim();
}

/** Longest saved-list name that this message is naming. */
export function matchSavedList(lists, text) {
  const hay = foldListKey(text);
  if (!hay || !Array.isArray(lists) || !lists.length) return null;
  const stripped = stripListCommand(text);
  const ranked = [...lists].sort(
    (a, b) => foldListKey(b.name).length - foldListKey(a.name).length
  );

  for (const list of ranked) {
    const name = foldListKey(list.name);
    if (!name) continue;
    if (stripped === name) return list;
    if (!name.endsWith(" list") && stripped === `${name} list`) return list;
    if (name.endsWith(" list") && stripped === name.replace(/ list$/, "")) return list;
  }

  for (const list of ranked) {
    const name = foldListKey(list.name);
    if (name.length >= 4 && (hay.includes(name) || stripped.includes(name))) return list;
  }
  return null;
}

export function formatSavedListsPrompt(lists, listMatch) {
  const catalog = Array.isArray(lists) ? lists : [];
  const body = catalog.length
    ? catalog.map((list) => `- ${list.name} (${list.count})`).join("\n")
    : "(none yet)";
  const matchLine = listMatch
    ? `\nTHIS TURN: the user named saved list "${listMatch.name}" (${listMatch.count} people). That is a console list, not a WhatsApp contact. Do not call search_lead_by_name. Use start_cold_batch with source="${listMatch.name}" and a LIVE script.`
    : "";
  return `SAVED LISTS (console CSV uploads on the dial roster — NOT WhatsApp inbox contacts):
${body}
If the user names one of these, pass that exact name as start_cold_batch source.${matchLine}`;
}

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

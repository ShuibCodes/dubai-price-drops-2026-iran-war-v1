import { nextAssignedAgentId } from "@/lib/leads/assigned-agent";
import { normalizePhone, phoneToWaId } from "@/lib/leads/normalize";
import { applyCampaignAgentScope } from "@/lib/jarvis/visibility";

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

export async function upsertListContacts(
  supabase,
  tenantId,
  { name, contacts, agentId }
) {
  const ownerId = String(agentId || "").trim();
  if (!ownerId) throw new Error("agentId is required to save list contacts.");

  const listName = normalizeListName(name);
  const rows = Array.isArray(contacts) ? contacts : [];
  if (!rows.length) {
    return { name: listName, saved: 0, skipped: 0, leadIds: [] };
  }

  const now = new Date().toISOString();
  let skipped = 0;

  // Step 1: Normalize phone numbers and collect unique valid contacts in memory
  const validContacts = [];
  const allWaIds = new Set();

  for (const contact of rows) {
    const phone = normalizePhone(contact?.phone || contact?.wa_id);
    const waId = phoneToWaId(phone);
    if (!waId) {
      skipped += 1;
      continue;
    }
    const pushName = String(contact?.name || "").trim() || null;
    validContacts.push({ waId, pushName });
    allWaIds.add(waId);
  }

  if (!validContacts.length) {
    return { name: listName, saved: 0, skipped, leadIds: [] };
  }

  // Step 2: Bulk query existing leads for all waIds in chunks (to stay well within query/URL limits)
  const existingMap = new Map();
  const LOOKUP_CHUNK_SIZE = 100;
  const waIdArray = Array.from(allWaIds);
  const lookupChunks = [];
  for (let i = 0; i < waIdArray.length; i += LOOKUP_CHUNK_SIZE) {
    lookupChunks.push(waIdArray.slice(i, i + LOOKUP_CHUNK_SIZE));
  }

  await Promise.all(
    lookupChunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, wa_id, opted_out, push_name, assigned_agent_id")
        .eq("tenant_id", tenantId)
        .in("wa_id", chunk);
      if (error) throw new Error(`Lead lookup failed: ${error.message}`);
      for (const lead of data || []) {
        existingMap.set(lead.wa_id, lead);
      }
    })
  );

  // Step 3: Classify each contact into insert, update, or skip
  const toInsert = [];
  const toUpdate = [];
  const statusByWaId = new Map(); // waId -> { leadId: string | null, skipped: boolean }

  for (const contact of validContacts) {
    const { waId, pushName } = contact;

    if (statusByWaId.has(waId)) {
      // Duplicate entry within this CSV file
      skipped += 1;
      continue;
    }

    const existing = existingMap.get(waId);

    if (existing?.opted_out) {
      skipped += 1;
      statusByWaId.set(waId, { leadId: null, skipped: true });
      continue;
    }

    if (existing) {
      if (
        existing.assigned_agent_id &&
        existing.assigned_agent_id !== ownerId
      ) {
        skipped += 1;
        statusByWaId.set(waId, { leadId: null, skipped: true });
        continue;
      }

      const patch = {
        source: listName,
        push_name: pushName || existing.push_name || null,
        last_message_at: now,
      };
      const nextOwner = nextAssignedAgentId(existing.assigned_agent_id, ownerId);
      if (nextOwner && nextOwner !== existing.assigned_agent_id) {
        patch.assigned_agent_id = nextOwner;
      }

      toUpdate.push({ id: existing.id, patch });
      statusByWaId.set(waId, { leadId: existing.id, skipped: false });
    } else {
      toInsert.push({
        tenant_id: tenantId,
        wa_id: waId,
        push_name: pushName,
        source: listName,
        first_seen: now,
        last_message_at: now,
        assigned_agent_id: ownerId,
      });
      statusByWaId.set(waId, { leadId: null, skipped: false });
    }
  }

  // Step 4: Bulk insert new leads in chunks (e.g. 100 per insert batch)
  const INSERT_CHUNK_SIZE = 100;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("leads")
      .insert(chunk)
      .select("id, wa_id");
    if (error) throw new Error(`Lead insert failed: ${error.message}`);
    for (const row of Array.isArray(data) ? data : data ? [data] : []) {
      const status = statusByWaId.get(row.wa_id);
      if (status) status.leadId = row.id;
    }
  }

  // Step 5: Perform updates in parallel chunks
  const UPDATE_CONCURRENCY = 25;
  for (let i = 0; i < toUpdate.length; i += UPDATE_CONCURRENCY) {
    const chunk = toUpdate.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(
      chunk.map(async ({ id, patch }) => {
        const { error } = await supabase
          .from("leads")
          .update(patch)
          .eq("id", id);
        if (error) throw new Error(`Lead update failed: ${error.message}`);
      })
    );
  }

  // Step 6: Assemble leadIds preserving order
  const ids = [];
  const seenIds = new Set();
  for (const contact of validContacts) {
    const status = statusByWaId.get(contact.waId);
    if (status?.leadId && !status.skipped && !seenIds.has(status.leadId)) {
      seenIds.add(status.leadId);
      ids.push(status.leadId);
    }
  }

  return { name: listName, saved: ids.length, skipped, leadIds: ids };
}

export async function listSavedLists(supabase, tenantId, agentId = null) {
  let query = supabase
    .from("leads")
    .select("source")
    .eq("opted_out", false)
    .not("source", "is", null)
    .limit(8000);
  query = agentId
    ? applyCampaignAgentScope(query, { tenantId, agentId })
    : query.eq("tenant_id", tenantId);
  const { data, error } = await query;
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

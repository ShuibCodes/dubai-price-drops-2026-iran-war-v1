import { getSupabaseServerClient } from "@/lib/supabase/server";
import { mergeCounts } from "./batches";

const WORTH_LIMIT = 5;

export function isRunStatusAsk(text) {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return (
    /\bhow'?s the run\b/i.test(t) ||
    /\bhow is the run\b/i.test(t) ||
    /\brun status\b/i.test(t) ||
    /\bstatus of (the )?(run|batch|list|cold)\b/i.test(t) ||
    /\bhow many (were |have been |have we )?(diall?ed|called)\b/i.test(t) ||
    /\b(how many|who).{0,24}\b(diall?ed|qualified)\b/i.test(t) ||
    /\bworth my time\b/i.test(t) ||
    /\bwho (is|are) (worth|qualified)\b/i.test(t) ||
    /\bqualified from\b/i.test(t) ||
    /\bcold call run\b/i.test(t) ||
    /\b(the |this )(run|batch)\b/i.test(t) ||
    /\bfrom the (run|batch)\b/i.test(t) ||
    /\b(diall?ed|dialling|dialing)\b/i.test(t)
  );
}

/** Prefetch when they name a list and also ask how it is going. */
export function shouldPrefetchRunStatus(text, namedList) {
  if (isRunStatusAsk(text)) return true;
  if (!namedList) return false;
  const t = String(text || "");
  const startingBatch =
    /\b(call|dial|queue|start|ring)\b/i.test(t) &&
    !/\b(how|status|snapshot|diall?ed|qualified|worth)\b/i.test(t);
  if (startingBatch) return false;
  return /\b(how'?s|how is|status|snapshot|update|going|diall?ed|dialling|qualified|worth|the run|batch)\b/i.test(
    t
  );
}

export function formatRunStatusBlock(runStatus) {
  if (!runStatus) return "";
  return (
    "\n\nTHIS TURN — CONSOLE RUN (already loaded). " +
    "Never say Vapi, console, or dial counts are unavailable on WhatsApp. " +
    "Never send the agent to the Vapi dashboard for this. " +
    "Do not use inbox tools to answer the run. " +
    "Lead with dialed/total from this JSON, then the exact sentence Ask me again later please. if ask_again_later is true, then list worth as name, full phone, tone, and quote in quotes. " +
    JSON.stringify(runStatus)
  );
}

/** Same scoring as the run results page. */
export function worthScore(call) {
  const q =
    call?.qualification && typeof call.qualification === "object"
      ? call.qualification
      : {};
  if (q.outcome === "qualified") return 50;
  if (q.outcome === "callback") return 40;
  if (q.lead_engaged) return 30;
  if (q.outcome === "not_interested") return 10;
  return 0;
}

export function worthTone(score) {
  if (score >= 50) return "HOT";
  if (score >= 30) return "WARM";
  return null;
}

/** First substantial thing the lead said — the console highlight quote. */
export function quotedSentence(call) {
  const transcript = String(call?.transcript || "");
  const lines = transcript
    .split("\n")
    .map((line) => line.replace(/^(User|Lead|Customer)\s*:\s*/i, "").trim())
    .filter((line) => line && !/^(AI|Assistant|Agent)\s*:/i.test(line));
  const sentence =
    lines.find((line) => line.length > 12) || String(call?.summary || "").trim();
  return sentence.slice(0, 240);
}

function personFrom(row) {
  const person = row?.leads || row?.jarvis_leads || {};
  const waId = String(person.wa_id || "").replace(/\D/g, "");
  return {
    name: String(person.push_name || "").trim() || (waId ? `+${waId}` : "Lead"),
    phone: waId ? `+${waId}` : null,
  };
}

function batchHaystack(batch) {
  const filter = batch?.filter && typeof batch.filter === "object" ? batch.filter : {};
  return [
    batch?.scripts?.display_name,
    batch?.source_type,
    filter.list_name,
    filter.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function pickBatch(batches, { script, list } = {}) {
  if (!batches?.length) return null;
  const needles = [script, list]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (!needles.length) return batches[0];
  return (
    batches.find((batch) => {
      const hay = batchHaystack(batch);
      return needles.every((needle) => hay.includes(needle));
    }) ||
    batches.find((batch) => {
      const hay = batchHaystack(batch);
      return needles.some((needle) => hay.includes(needle));
    }) ||
    null
  );
}

/**
 * One round-trip payload for WhatsApp: dialled/total, qualified, top worth-your-time
 * people with the same name / number / quote as the console.
 */
export async function getRunStatus(tenantId, { script, list } = {}) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { data: batches, error: batchError } = await supabase
    .from("call_batches")
    .select(
      "id, status, source_type, created_at, counts, filter, scripts(display_name)"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (batchError) throw new Error(`Run lookup failed: ${batchError.message}`);

  const batch = pickBatch(batches, { script, list });
  if (!batch) {
    return {
      found: false,
      instruction:
        "No console run for this tenant. Say so. Do not invent numbers.",
    };
  }

  const [{ data: calls, error: callsError }, { count: remaining, error: queueError }] =
    await Promise.all([
      supabase
        .from("calls")
        .select(
          "id, lead_id, jarvis_lead_id, summary, transcript, qualification, leads(push_name, wa_id), jarvis_leads(push_name, wa_id)"
        )
        .eq("tenant_id", tenantId)
        .eq("batch_id", batch.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("call_queue")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("batch_id", batch.id)
        .eq("processed", false),
    ]);
  if (callsError) throw new Error(`Run calls lookup failed: ${callsError.message}`);
  if (queueError) throw new Error(`Run queue lookup failed: ${queueError.message}`);

  const counts = mergeCounts(batch.counts);
  const callRows = calls || [];
  const dialed = counts.dialed || callRows.length;
  const total = Math.max(counts.queued || 0, dialed + (remaining || 0));
  const stillGoing =
    (remaining || 0) > 0 ||
    batch.status === "queued" ||
    batch.status === "running" ||
    (total > 0 && dialed < total);

  const ranked = callRows
    .map((call) => {
      const score = worthScore(call);
      const person = personFrom(call);
      return {
        name: person.name,
        phone: person.phone,
        tone: worthTone(score),
        quote: quotedSentence(call) || null,
        worth: score,
      };
    })
    .filter((row) => row.worth >= 30)
    .sort((a, b) => b.worth - a.worth)
    .slice(0, WORTH_LIMIT)
    .map(({ worth: _worth, ...row }) => row);

  const qualified =
    counts.qualified ||
    callRows.filter((call) => worthScore(call) >= 50).length;

  return {
    found: true,
    script_name: batch.scripts?.display_name || "Untitled script",
    status: batch.status,
    dialed,
    total,
    qualified,
    worth_count: ranked.length,
    still_going: stillGoing,
    ask_again_later: stillGoing,
    worth: ranked,
    instruction: stillGoing
      ? `Lead with "${dialed}/${total} dialled. Ask me again later please." Then list worth (name, phone, tone, quote). Do not invent people or quotes. If worth is empty, say nobody is worth a callback yet.`
      : `Lead with "${dialed}/${total} dialled." Then list worth (name, phone, tone, quote). Do not invent people or quotes. If worth is empty, say nobody is worth a callback yet.`,
  };
}

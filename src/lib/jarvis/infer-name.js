import Anthropic from "@anthropic-ai/sdk";
import { MESSAGES_TABLE } from "@/lib/supabase/server";
import { JARVIS_LEADS_TABLE } from "@/lib/ingest/jarvis-ingest";

const MODEL = "claude-sonnet-4-6";
const EARLY_MESSAGE_LIMIT = 10;
const INFER_CONCURRENCY = 3;

const EXTRACTION_PROMPT = `You are extracting a contact's name from the opening messages of a WhatsApp thread.

Messages are labeled INBOUND (from the contact) or OUTBOUND (from the account owner).

Return ONLY a JSON object, no markdown, no preamble:
{"name": string | null, "confidence": "high" | "medium" | "low"}

Rules:
- INBOUND self-introduction is the strongest signal ("my name is Tom", "Tom here", "this is Tom from Bayut"). → high
- OUTBOUND direct address is strong ("Hi Tom", "Tom, are you free?", "is this Tom?"). → high
- A name appearing once, ambiguously, or possibly referring to a third party ("Tom said he'd call you", "ask Tom") → medium at best, often low.
- Third parties are the main failure mode. The name must plausibly belong to the person in this conversation, not someone discussed in it.
- Ignore generic address terms that are not names: bro, boss, mate, habibi, sir, madam, chief, G, akhi, brother, buddy, man, dear.
- Ignore business/brand names unless clearly used as the person's own name.
- If OUTBOUND contains a name but it is the sender introducing THEMSELVES ("Hi, it's Ahmed from Sterling"), that is the account owner, not the contact. Do not return it.
- If two different candidate names appear, return low confidence unless one is clearly the contact.
- Return the first name only, capitalized normally. No surnames, no titles.
- If unsure at all, return null. A wrong name is worse than no name.`;

const CONFIDENCES = new Set(["high", "medium", "low"]);

export function formatJarvisLeadName({
  push_name,
  inferred_name,
  inferred_name_confidence,
} = {}) {
  const push = String(push_name || "").trim();
  if (push) {
    return {
      displayName: push,
      nameSource: "push",
      nameConfidence: null,
    };
  }

  const inferred = String(inferred_name || "").trim();
  const confidence = CONFIDENCES.has(inferred_name_confidence)
    ? inferred_name_confidence
    : null;

  if (inferred && confidence === "high") {
    return {
      displayName: inferred,
      nameSource: "inferred",
      nameConfidence: "high",
    };
  }

  if (inferred && confidence === "medium") {
    return {
      displayName: `${inferred}?`,
      nameSource: "inferred",
      nameConfidence: "medium",
    };
  }

  return {
    displayName: null,
    nameSource: null,
    nameConfidence: confidence === "low" ? "low" : null,
  };
}

function needsInference(lead) {
  if (!lead?.id) return false;
  if (String(lead.push_name || "").trim()) return false;
  if (lead.inferred_name_at) return false;
  return true;
}

function normalizeExtractedName(raw) {
  const name = String(raw || "")
    .trim()
    .replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "")
    .split(/\s+/)[0];
  if (!name || name.length < 2 || name.length > 30) return null;
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(name)) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function parseExtraction(text) {
  const raw = String(text || "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { name: null, confidence: "low" };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const name = normalizeExtractedName(parsed?.name);
    let confidence = String(parsed?.confidence || "").toLowerCase();
    if (!CONFIDENCES.has(confidence)) confidence = name ? "medium" : "low";
    if (!name) return { name: null, confidence: "low" };
    return { name, confidence };
  } catch {
    return { name: null, confidence: "low" };
  }
}

async function loadEarlyMessages(supabase, tenantId, jarvisLeadId) {
  const { data, error } = await supabase
    .from(MESSAGES_TABLE)
    .select("direction, body, msg_type, timestamp")
    .eq("tenant_id", tenantId)
    .eq("jarvis_lead_id", jarvisLeadId)
    .order("timestamp", { ascending: true })
    .limit(EARLY_MESSAGE_LIMIT);
  if (error) throw new Error(`Early messages query failed: ${error.message}`);
  return data || [];
}

function formatMessagesForPrompt(messages) {
  return messages
    .map((message) => {
      const label = message.direction === "inbound" ? "INBOUND" : "OUTBOUND";
      const body =
        String(message.body || "").trim() ||
        `[${message.msg_type || "message"}]`;
      return `${label}: ${body.slice(0, 300)}`;
    })
    .join("\n");
}

async function stampInference(supabase, leadId, { name, confidence }) {
  const { data, error } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .update({
      inferred_name: name,
      inferred_name_confidence: confidence,
      inferred_name_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .select(
      "id, push_name, wa_id, inferred_name, inferred_name_confidence, inferred_name_at"
    )
    .single();
  if (error) throw new Error(`Inference cache write failed: ${error.message}`);
  return data;
}

async function extractNameWithClaude(messageBlock) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 80,
    system: EXTRACTION_PROMPT,
    messages: [
      {
        role: "user",
        content: messageBlock || "(no messages)",
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return parseExtraction(text);
}

/**
 * Infer and cache a display name for one jarvis lead when push_name is null
 * and inference has never been attempted.
 */
export async function ensureJarvisInferredName(supabase, tenantId, lead) {
  if (!supabase || !tenantId || !lead?.id) return lead;
  if (!needsInference(lead)) return lead;

  try {
    const messages = await loadEarlyMessages(supabase, tenantId, lead.id);
    let extracted = { name: null, confidence: "low" };
    if (messages.length) {
      extracted = await extractNameWithClaude(formatMessagesForPrompt(messages));
    }
    const updated = await stampInference(supabase, lead.id, extracted);
    return { ...lead, ...updated };
  } catch (error) {
    console.error(
      `[jarvis/infer-name] failed for ${lead.id}:`,
      error instanceof Error ? error.message : error
    );
    try {
      const updated = await stampInference(supabase, lead.id, {
        name: null,
        confidence: "low",
      });
      return { ...lead, ...updated };
    } catch (stampError) {
      console.error(
        `[jarvis/infer-name] stamp failed for ${lead.id}:`,
        stampError instanceof Error ? stampError.message : stampError
      );
      return {
        ...lead,
        inferred_name: null,
        inferred_name_confidence: "low",
        inferred_name_at: new Date().toISOString(),
      };
    }
  }
}

async function mapPool(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/**
 * Batch-infer for a list of lead-shaped objects that include id + name fields.
 * Returns a Map of leadId → enriched lead row fields.
 */
export async function ensureJarvisInferredNames(supabase, tenantId, leads) {
  const list = Array.isArray(leads) ? leads : [];
  const byId = new Map(list.filter((lead) => lead?.id).map((lead) => [lead.id, lead]));
  const candidates = [...byId.values()].filter(needsInference);

  if (!candidates.length) return byId;

  const enriched = await mapPool(
    candidates,
    INFER_CONCURRENCY,
    (lead) => ensureJarvisInferredName(supabase, tenantId, lead)
  );

  for (const lead of enriched) {
    if (lead?.id) byId.set(lead.id, lead);
  }
  return byId;
}

/** Attach displayName / nameSource / nameConfidence onto a conversation/lead object. */
export function applyDisplayName(row, nameFields = {}) {
  const formatted = formatJarvisLeadName({
    push_name: nameFields.push_name ?? row.push_name ?? row.leadName,
    inferred_name: nameFields.inferred_name ?? row.inferred_name,
    inferred_name_confidence:
      nameFields.inferred_name_confidence ?? row.inferred_name_confidence,
  });
  return {
    ...row,
    leadName: formatted.displayName,
    nameSource: formatted.nameSource,
    nameConfidence: formatted.nameConfidence,
  };
}

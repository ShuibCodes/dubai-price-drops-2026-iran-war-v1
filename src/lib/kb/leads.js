import fs from "fs";
import path from "path";

const WHATSAPP_DIR = path.join(process.cwd(), "data", "whatsapp");
const CRM_DIR = path.join(process.cwd(), "data", "crm");

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizePhoneDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function phonesMatch(a, b) {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 8 && longer.endsWith(shorter);
}

/**
 * @param {Record<string, unknown>} lead
 * @returns {string}
 */
function mergeKey(lead) {
  const phone = clean(lead.phone);
  if (phone) return `phone:${normalizePhoneDigits(phone)}`;
  return `name:${lead.normalizedName}`;
}

/**
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} incoming
 */
function mergeLeadRecords(base, incoming) {
  const pick = (field) => {
    const a = base[field];
    const b = incoming[field];
    if (a != null && a !== "") return a;
    return b != null && b !== "" ? b : a;
  };

  const interests = [
    ...(Array.isArray(base.interests) ? base.interests : []),
    ...(Array.isArray(incoming.interests) ? incoming.interests : []),
  ].filter(Boolean);
  const uniqueInterests = [...new Set(interests)];

  const notesParts = [clean(base.notes), clean(incoming.notes)].filter(Boolean);
  const uniqueNotes = [...new Set(notesParts)];

  const sources = new Set([
    ...(Array.isArray(base.sources) ? base.sources : []),
    ...(Array.isArray(incoming.sources) ? incoming.sources : []),
  ]);

  return {
    ...base,
    ...incoming,
    name: pick("name"),
    phone: pick("phone"),
    email: pick("email"),
    area: pick("area"),
    budget: pick("budget"),
    budgetRaw: pick("budgetRaw"),
    bedrooms: pick("bedrooms"),
    lastContact: pick("lastContact"),
    status: pick("status"),
    notes: uniqueNotes.join(" | ") || null,
    interests: uniqueInterests,
    fileName: base.fileName || incoming.fileName || null,
    crmFile: base.crmFile || incoming.crmFile || null,
    sources: [...sources],
    normalizedName: normalizeName(pick("name")),
    firstName: normalizeName(pick("name")).split(" ")[0],
  };
}

function extractAreaFromContent(content = "") {
  const preferredArea = content.match(/^Preferred Area:\s*(.+)$/im)?.[1];
  if (preferredArea) return clean(preferredArea);

  const leadContextArea = content.match(
    /^Lead Context:\s*Preferred listing area is\s+(.+?)(?:\s*\(|\.|$)/im,
  )?.[1];
  if (leadContextArea) return clean(leadContextArea);

  const firstKnownArea = [
    "Dubai Marina",
    "Jumeirah",
    "JVC",
    "Business Bay",
    "Downtown",
    "Palm Jumeirah",
    "Meydan",
    "Dubai Hills",
    "Creek Harbour",
  ].find((area) => content.toLowerCase().includes(area.toLowerCase()));

  return firstKnownArea ?? null;
}

/**
 * @param {string} content
 * @returns {import('./leads').LeadContact | null}
 */
function parseWhatsAppLeadFile(fileName, content) {
  const headerName =
    content.match(/^Client Contact:\s*(.+?)\s*\|/im)?.[1] ||
    content.match(/^Lead Name:\s*(.+)$/im)?.[1];
  const phoneMatch =
    content.match(/WhatsApp:\s*([+0-9][0-9+\-\s]{6,})/i)?.[1] ||
    content.match(/^Phone:\s*([+0-9][0-9+\-\s]{6,})/im)?.[1];
  const name = clean(headerName);
  const phone = clean(phoneMatch).replace(/\s+/g, " ");
  if (!name) return null;

  const email = content.match(/^Email:\s*([^\s]+@[^\s]+\.[^\s]+)$/im)?.[1] ?? null;
  const area =
    extractAreaFromContent(content) ||
    clean(content.match(/^Preferred Area:\s*(.+)$/im)?.[1]) ||
    null;
  const bedrooms = clean(content.match(/^Bedroom Requirement:\s*(.+)$/im)?.[1]) || null;
  const budgetRaw =
    clean(content.match(/^Budget:\s*(.+)$/im)?.[1]) ||
    clean(content.match(/^Budget \(AED\):\s*(.+)$/im)?.[1]) ||
    null;
  const lastContact =
    clean(content.match(/^Last (?:Interaction|Contact):\s*(.+)$/im)?.[1]) || null;
  const status = clean(content.match(/^Status:\s*(.+)$/im)?.[1]) || null;
  const notes = clean(content.match(/^Notes:\s*(.+)$/im)?.[1]) || null;

  const interests = [];
  for (const line of content.split("\n")) {
    const ctx = line.match(/^Lead Context:\s*(.+)$/i);
    if (ctx) interests.push(clean(ctx[1]));
  }

  return {
    name,
    normalizedName: normalizeName(name),
    firstName: normalizeName(name).split(" ")[0],
    phone: phone || null,
    email: email ? clean(email) : null,
    area,
    budget: null,
    budgetRaw,
    bedrooms,
    lastContact,
    status,
    notes,
    interests,
    sources: ["whatsapp"],
    fileName,
    crmFile: null,
  };
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} crmFile
 * @returns {import('./leads').LeadContact | null}
 */
function parseCrmLeadRecord(record, crmFile) {
  if (!record || record.type !== "crm-lead") return null;
  const name = clean(record.name);
  if (!name) return null;

  const phone = clean(record.phone) || null;
  const interests = [];
  if (record.area) interests.push(`Interested in ${record.area}`);
  if (record.bedrooms) interests.push(`${record.bedrooms} bedrooms`);
  if (record.budgetRaw) interests.push(`Budget ${record.budgetRaw}`);
  else if (record.budget) interests.push(`Budget AED ${record.budget}`);

  return {
    name,
    normalizedName: normalizeName(name),
    firstName: normalizeName(name).split(" ")[0],
    phone,
    email: clean(record.email) || null,
    area: clean(record.area) || null,
    budget: typeof record.budget === "number" ? record.budget : null,
    budgetRaw: clean(record.budgetRaw) || null,
    bedrooms: clean(record.bedrooms) || null,
    lastContact: clean(record.lastContact) || null,
    status: clean(record.status) || null,
    notes: clean(record.notes) || null,
    interests,
    sources: ["crm"],
    fileName: null,
    crmFile,
  };
}

function loadWhatsAppLeads() {
  if (!fs.existsSync(WHATSAPP_DIR)) return [];

  const files = fs
    .readdirSync(WHATSAPP_DIR)
    .filter((name) => name.toLowerCase().endsWith(".txt"));
  const leads = [];

  for (const fileName of files) {
    const fullPath = path.join(WHATSAPP_DIR, fileName);
    const content = fs.readFileSync(fullPath, "utf8");
    const lead = parseWhatsAppLeadFile(fileName, content);
    if (lead) leads.push(lead);
  }

  return leads;
}

function loadCrmLeads() {
  if (!fs.existsSync(CRM_DIR)) return [];

  const files = fs
    .readdirSync(CRM_DIR)
    .filter((name) => name.toLowerCase().endsWith(".jsonl"));
  const leads = [];

  for (const fileName of files) {
    const fullPath = path.join(CRM_DIR, fileName);
    const lines = fs.readFileSync(fullPath, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const lead = parseCrmLeadRecord(obj, fileName);
        if (lead) leads.push(lead);
      } catch {
        continue;
      }
    }
  }

  return leads;
}

/**
 * @param {import('./leads').LeadContact[]} list
 */
function dedupeAndMergeLeads(list) {
  /** @type {Map<string, import('./leads').LeadContact>} */
  const byKey = new Map();

  for (const lead of list) {
    const key = mergeKey(lead);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, lead);
      continue;
    }

    if (
      existing.normalizedName !== lead.normalizedName &&
      existing.phone &&
      lead.phone &&
      phonesMatch(existing.phone, lead.phone)
    ) {
      byKey.set(key, mergeLeadRecords(existing, lead));
      continue;
    }

    if (existing.normalizedName === lead.normalizedName) {
      byKey.set(key, mergeLeadRecords(existing, lead));
      continue;
    }

    byKey.set(`${key}:${lead.normalizedName}`, lead);
  }

  return [...byKey.values()];
}

/**
 * Unified roster from WhatsApp context files + CRM JSONL imports.
 * @returns {import('./leads').LeadContact[]}
 */
export function getAllLeadContacts() {
  return dedupeAndMergeLeads([...loadWhatsAppLeads(), ...loadCrmLeads()]);
}

/**
 * @param {import('./leads').LeadContact} lead
 * @returns {string}
 */
export function formatLeadProfile(lead) {
  const lines = [];
  const phonePart = lead.phone ? ` | WhatsApp: ${lead.phone}` : "";
  lines.push(`Client Contact: ${lead.name}${phonePart}`);

  if (lead.area) lines.push(`Preferred Area: ${lead.area}`);
  if (lead.bedrooms) lines.push(`Bedroom Requirement: ${lead.bedrooms}`);
  if (lead.budgetRaw) lines.push(`Budget: ${lead.budgetRaw}`);
  else if (lead.budget) lines.push(`Budget: AED ${lead.budget.toLocaleString()}`);
  if (lead.lastContact) lines.push(`Last Contact: ${lead.lastContact}`);
  if (lead.status) lines.push(`Status: ${lead.status}`);
  if (lead.email) lines.push(`Email: ${lead.email}`);
  if (lead.notes) lines.push(`Notes: ${lead.notes}`);

  for (const interest of lead.interests || []) {
    if (interest && !lines.some((l) => l.includes(interest))) {
      lines.push(`Lead Context: ${interest}`);
    }
  }

  const sources = (lead.sources || []).join(" + ");
  if (sources) lines.push(`Source: ${sources}`);

  return lines.join("\n");
}

/** Compact roster for the system prompt. */
export function buildLeadRosterText() {
  const leads = getAllLeadContacts();
  if (!leads.length) return "(No leads in roster yet.)";
  return leads.map(formatLeadProfile).join("\n\n---\n\n");
}

/**
 * Format a CRM JSONL file for KB corpus (same shape as WhatsApp context).
 * @param {string} filePath
 * @returns {string}
 */
export function formatCrmJsonlForKb(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) return "";

  const lines = fs.readFileSync(fullPath, "utf8").split("\n");
  const profiles = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const lead = parseCrmLeadRecord(obj, path.basename(filePath));
      if (lead) profiles.push(formatLeadProfile(lead));
    } catch {
      continue;
    }
  }

  if (!profiles.length) return fs.readFileSync(fullPath, "utf8");
  return profiles.join("\n\n---\n\n");
}

export function resolveLeadByName(inputName) {
  const query = normalizeName(inputName);
  const leads = getAllLeadContacts();
  if (!query) return { matches: [], leads };

  const exact = leads.filter((lead) => lead.normalizedName === query);
  if (exact.length) return { matches: exact, leads };

  const startsWith = leads.filter(
    (lead) =>
      lead.normalizedName.startsWith(query) ||
      query.startsWith(lead.firstName) ||
      lead.firstName === query,
  );
  if (startsWith.length) return { matches: startsWith, leads };

  const contains = leads.filter(
    (lead) =>
      lead.normalizedName.includes(query) || query.includes(lead.normalizedName),
  );
  return { matches: contains, leads };
}

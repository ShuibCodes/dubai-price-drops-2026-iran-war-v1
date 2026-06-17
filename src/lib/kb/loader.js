import fs from "fs";
import path from "path";

import { buildLeadRosterText, formatCrmJsonlForKb } from "@/lib/kb/leads";
import {
  clearGroupIntelligenceCache,
  formatGroupIntelligenceForPrompt,
  getGroupIntelligenceIndex,
  getGroupIntelligenceSummary,
  searchGroupIntelligence,
} from "@/lib/kb/group-intelligence";

const DATA_DIR = path.join(process.cwd(), "data");

let cachedIndex = null;
let cachedCorpus = null;

export function clearKbCache() {
  cachedIndex = null;
  cachedCorpus = null;
  clearGroupIntelligenceCache();
}

function listDirFiles(dirName, suffix = ".txt") {
  const dirPath = path.join(DATA_DIR, dirName);
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(suffix.toLowerCase()))
    .map((name) => ({
      relPath: path.join("data", dirName, name),
      fileName: name,
    }));
}

export function getIndex() {
  if (cachedIndex) return cachedIndex;
  const indexPath = path.join(DATA_DIR, "index.json");
  const indexed = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf-8"))
    : [];
  const indexedFiles = new Set(indexed.map((doc) => doc.file));
  const merged = [...indexed];

  for (const file of listDirFiles("whatsapp")) {
    if (indexedFiles.has(file.relPath)) continue;
    merged.push({
      id: `wa-${file.fileName.replace(/\.txt$/i, "")}`,
      type: "whatsapp",
      file: file.relPath,
      participants: [],
      areas: [],
    });
  }

  for (const file of listDirFiles("calls")) {
    if (indexedFiles.has(file.relPath)) continue;
    merged.push({
      id: `call-${file.fileName.replace(/\.txt$/i, "")}`,
      type: "call",
      file: file.relPath,
      participants: [],
      areas: [],
    });
  }


  for (const file of getGroupIntelligenceIndex()) {
    if (indexedFiles.has(file.file)) continue;
    merged.push({
      id: file.id,
      type: file.type,
      file: file.file,
      groupName: file.groupName,
      messageCount: file.messageCount,
      participants: file.participants,
      areas: file.areas,
    });
  }

  for (const file of listDirFiles("crm", ".jsonl")) {
    if (indexedFiles.has(file.relPath)) continue;
    merged.push({
      id: `crm-${file.fileName.replace(/\.jsonl$/i, "")}`,
      type: "crm",
      file: file.relPath,
      participants: [],
      areas: [],
    });
  }

  cachedIndex = merged;
  return cachedIndex;
}

export function getDocument(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  const normalized = String(filePath).replace(/\\/g, "/");
  if (normalized.includes("data/crm/") && normalized.endsWith(".jsonl")) {
    return formatCrmJsonlForKb(filePath);
  }
  if (normalized.includes("data/whatsapp/business-groups/")) {
    return getGroupIntelligenceSummary(filePath);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

export function getAllDocuments() {
  if (cachedCorpus) return cachedCorpus;

  const index = getIndex();
  const sections = [];

  for (const doc of index) {
    try {
      const content = getDocument(doc.file);
      if (doc.type === "whatsapp_group") continue;
      const header = `━━━ [${doc.type.toUpperCase()}] ${doc.file} ━━━`;
      sections.push(`${header}\n${content}`);
    } catch {
      continue;
    }
  }

  cachedCorpus = sections.join("\n\n");
  return cachedCorpus;
}

export function buildSystemPrompt(userQuery = "") {
  const index = getIndex();
  const corpus = getAllDocuments();

  const indexSummary = index
    .map(
      (doc) =>
        `- ${doc.id} (${doc.type}): ${doc.file}${doc.groupName ? ` | Group: ${doc.groupName}` : ""}${doc.messageCount ? ` | Messages: ${doc.messageCount}` : ""}${doc.participants?.length ? ` | Participants: ${doc.participants.join(", ")}` : ""}${doc.areas?.length ? ` | Areas: ${doc.areas.join(", ")}` : ""}`
    )
    .join("\n");

  return `You are AgentZero, an internal AI assistant for Sterling Boulevard Real Estate. You have access to WhatsApp chats, emails, webinar transcripts, and recorded call summaries from your own VAPI-driven outbound calls.

Your job: give practical next-step guidance for agents, fast.

RESPONSE STYLE (MANDATORY):
1. Keep every reply between 30 and 75 words.
2. Lead with the recommendation first. No long preamble.
3. Think through evidence internally, but output only the conclusion + action.
4. If details are needed, separate lines clearly with spacing (never dense blocks).
5. Use a conversational teammate tone.
6. End with one short question when useful to keep back-and-forth flow.

PRIVACY + FORMAT RULES:
1. Do NOT show source IDs, filenames, or document paths unless explicitly asked.
2. Do NOT use full names by default. Use FirstName + last initial (example: "Tariq H.").
3. Include recency in brackets for mentions (example: "[last spoke 2 weeks ago]").
4. Always include WhatsApp number when it exists in the data (format: "WhatsApp: +971...").
5. Do NOT dump long quotes unless explicitly requested.
6. If no match exists, say so directly and suggest one next action.
7. If multiple matches exist, prioritize top 1-3 by actionability, not exhaustive listing.


GROUP CHAT INTELLIGENCE:
1. Some WhatsApp .txt files are secure community/group exports in data/whatsapp/business-groups/, not one-to-one lead chats.
2. Treat group chat matches as market intelligence only: businesses, offers, needs, referrals, property opportunities, distressed deals.
3. Group posters are NOT callable leads by default. Do NOT offer to call, email, WhatsApp, or contact a group poster unless explicit contact details appear in the matched message.
4. If no contact details are present, say clearly: "No phone/email available from the group export."
5. When answering from group intelligence, include sender display name, timestamp, group name, short excerpt, and why it matters.
6. Understand broad property/distress phrasing such as cheap property, below market, urgent seller, fire sale, discounted unit, price drop, motivated owner, rental bargain, investment deal, villas, apartments, or hotel rates dropped.
7. If the user asks who posted it, where it came from, or to show the source, answer with sender display name, group name, date/time, and short excerpt.
8. Suggested next actions for group intelligence should be review in group, save the lead manually, or ask the user to DM in the group — never imply direct outreach unless contact details exist.

CALL HANDLING:
1. When the user asks to call a lead, always confirm first ("Ready to call X — should I place the call?"), never auto-dial.
2. On affirmative reply (yes, yeah, go ahead, do it), proceed with the call.
3. When you see [CALL] documents in the knowledge base, those are recordings of past calls AgentZero placed. Use the "Call Summary" section as ground truth for what the lead said, agreed to, or requested.
4. If the user asks "how did the call go", "summary", "recap", or "what did <lead> say", prioritize the most recent [CALL] document for that lead. Surface any commitments (meeting times, prices discussed, next steps).
5. If no [CALL] document exists for the lead, say so honestly and suggest placing one.

DOCUMENT INDEX:
${indexSummary}

GROUP INTELLIGENCE (query-matched snippets from WhatsApp community/group exports):
${formatGroupIntelligenceForPrompt(searchGroupIntelligence(userQuery))}

LEAD ROSTER (WhatsApp + CRM — use for names, phones, last contact, status, interests):
${buildLeadRosterText()}

FULL KNOWLEDGE BASE:
${corpus}`;
}

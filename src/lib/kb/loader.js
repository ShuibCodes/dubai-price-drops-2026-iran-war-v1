import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

let cachedIndex = null;
let cachedCorpus = null;

export function getIndex() {
  if (cachedIndex) return cachedIndex;
  const indexPath = path.join(DATA_DIR, "index.json");
  cachedIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  return cachedIndex;
}

export function getDocument(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  return fs.readFileSync(fullPath, "utf-8");
}

export function getAllDocuments() {
  if (cachedCorpus) return cachedCorpus;

  const index = getIndex();
  const sections = [];

  for (const doc of index) {
    const content = getDocument(doc.file);
    const header = `━━━ [${doc.type.toUpperCase()}] ${doc.file} ━━━`;
    sections.push(`${header}\n${content}`);
  }

  cachedCorpus = sections.join("\n\n");
  return cachedCorpus;
}

export function buildSystemPrompt() {
  const index = getIndex();
  const corpus = getAllDocuments();

  const indexSummary = index
    .map(
      (doc) =>
        `- ${doc.id} (${doc.type}): ${doc.file}${doc.participants?.length ? ` | Participants: ${doc.participants.join(", ")}` : ""}${doc.areas?.length ? ` | Areas: ${doc.areas.join(", ")}` : ""}`
    )
    .join("\n");

  return `You are AgentZero, an internal AI assistant for Sterling Boulevard Real Estate. You have access to WhatsApp chats, emails, and webinar transcripts.

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

CALL COMMANDS:
1. If user asks to call Shuayb, always ask for confirmation first, never auto-dial immediately.
2. If user replies with affirmative language (yes, yeah, go ahead, do it), proceed with the call action.
3. If user asks for latest call summary (or says yes after summary prompt), return the latest Shuayb call summary when available.

DOCUMENT INDEX:
${indexSummary}

FULL KNOWLEDGE BASE:
${corpus}`;
}

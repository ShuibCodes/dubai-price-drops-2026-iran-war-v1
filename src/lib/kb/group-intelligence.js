import fs from "fs";
import path from "path";

import { parseWhatsAppExport } from "./whatsapp-parser.js";

const GROUP_DIR = path.join(process.cwd(), "data", "whatsapp", "business-groups");

const NOISE_PATTERNS = [
  /joined from the community/i,
  /created this group/i,
  /messages and calls are end-to-end encrypted/i,
  /you joined from/i,
  /this group has over \d+ members/i,
  /^[\u200e\s]*image omitted$/i,
  /^[\u200e\s]*video omitted$/i,
  /^[\u200e\s]*audio omitted$/i,
  /^[\u200e\s]*document omitted$/i,
  /^[\u200e\s]*sticker omitted$/i,
  /^[\u200e\s]*gif omitted$/i,
  /^\s*$/,
];

const PROPERTY_INTENT_TERMS = [
  "distress", "distressed", "below market", "urgent", "fire sale", "motivated",
  "price drop", "discount", "discounted", "cheap", "bargain", "sale", "rent",
  "rental", "villa", "apartment", "studio", "property", "real estate", "invest",
  "investment", "off-plan", "offplan", "penthouse", "bedroom", "bed", "sqft",
  "sq ft", "aed", "million", "hotel", "marina", "jlt", "downtown", "jvc",
  "ranches", "viewing", "pm me", "for sale", "for rent", "listing", "unit",
  "developer", "townhouse", "duplex", "triplex", "furnished", "tenanted", "yield",
];

const GROUP_QUERY_TRIGGERS = [
  "group", "groups", "community", "pb", "business group", "business & sales",
  "distress", "deal", "deals", "property", "properties", "rent", "rental",
  "sale", "villa", "apartment", "invest", "posted", "who mentioned",
  "below market", "cheap", "urgent", "opportunity", "opportunities", "referral",
  "business", "offer",
];

let cachedGroups = null;

export function clearGroupIntelligenceCache() {
  cachedGroups = null;
}

function isNoiseMessage(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed.length < 10) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isJoinOnlyMessage(text) {
  return /joined from the community/i.test(text) && text.length < 120;
}

function inferGroupName(messages, fileName) {
  for (const message of messages) {
    if (/end-to-end encrypted/i.test(message.text)) {
      return message.sender.replace(/:\s*$/, "").trim();
    }
  }

  for (const message of messages) {
    const sender = message.sender.replace(/:\s*$/, "").trim();
    if (sender.includes("|") && !sender.startsWith("~")) {
      return sender;
    }
  }

  return fileName.replace(/\.txt$/i, "").replace(/-/g, " ");
}

function loadGroupTranscripts() {
  if (cachedGroups) return cachedGroups;

  if (!fs.existsSync(GROUP_DIR)) {
    cachedGroups = [];
    return cachedGroups;
  }

  const files = fs
    .readdirSync(GROUP_DIR)
    .filter((name) => name.toLowerCase().endsWith(".txt"));

  cachedGroups = files.map((fileName) => {
    const relPath = path.join("data", "whatsapp", "business-groups", fileName);
    const content = fs.readFileSync(path.join(GROUP_DIR, fileName), "utf8");
    const parsed = parseWhatsAppExport(content, "", {
      filename: fileName,
      source: "whatsapp_group",
    })[0];

    const groupName = inferGroupName(parsed.messages, fileName);
    const messages = parsed.messages.filter(
      (message) => !isNoiseMessage(message.text) && !isJoinOnlyMessage(message.text),
    );

    return { id: parsed.id, fileName, relPath, groupName, messages };
  });

  return cachedGroups;
}

export function getGroupIntelligenceIndex() {
  return loadGroupTranscripts().map((group) => ({
    id: `wa-group-${group.fileName.replace(/\.txt$/i, "")}`,
    type: "whatsapp_group",
    file: group.relPath.replace(/\\/g, "/"),
    groupName: group.groupName,
    messageCount: group.messages.length,
    participants: [],
    areas: [],
  }));
}

function tokenizeQuery(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2);
}

function detectGroupQueryIntent(query) {
  const normalized = String(query || "").toLowerCase();
  return GROUP_QUERY_TRIGGERS.some((term) => normalized.includes(term));
}

function normalizePhone(rawPhone) {
  const cleaned = String(rawPhone || "").replace(/[^\d+]/g, "");
  if (!cleaned) return null;

  if (cleaned.startsWith("+")) {
    return `+${cleaned.slice(1).replace(/\D/g, "")}`;
  }

  if (cleaned.startsWith("00")) {
    return `+${cleaned.slice(2).replace(/\D/g, "")}`;
  }

  const digits = cleaned.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("971")) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith("05")) return `+971${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `+971${digits}`;
  return digits;
}

function extractPhoneFromText(text) {
  const source = String(text || "");
  const labeled =
    source.match(/(?:whatsapp|phone|mobile|call|contact|dm|message me)[^\d+]*(\+?\d[\d\s\-().]{7,}\d)/i)?.[1] ||
    source.match(/(\+971[\d\s\-().]{7,}\d)/i)?.[1] ||
    source.match(/\b(0?5\d[\d\s\-().]{7,}\d)\b/)?.[1];
  if (!labeled) return null;
  return normalizePhone(labeled);
}

function extractContactHints(text) {
  const phone = extractPhoneFromText(text);
  const email = text.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i)?.[1];
  const parts = [];
  if (phone) parts.push(`phone ${phone}`);
  if (email) parts.push(`email ${email}`);
  return parts.length ? parts.join(", ") : null;
}

function scoreMessage(message, queryTokens) {
  const haystack = `${message.sender} ${message.text}`.toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 3;
  }

  for (const term of PROPERTY_INTENT_TERMS) {
    if (haystack.includes(term)) score += 2;
  }

  if (message.text.length > 80) score += 1;
  if (/for sale|for rent|\baed\b|\d+\s*k|\d+\s*m\b/i.test(message.text)) score += 4;
  if (/distress|below market|urgent|discount|motivated|fire sale|price drop|\d+% off/i.test(message.text)) {
    score += 6;
  }

  return score;
}

export function searchGroupIntelligence(userQuery, options = {}) {
  const maxResults = options.maxResults ?? 8;
  const groups = loadGroupTranscripts();
  if (!groups.length) return [];

  const queryTokens = tokenizeQuery(userQuery);
  const hasIntent = detectGroupQueryIntent(userQuery) || queryTokens.length > 0;
  if (!hasIntent) return [];

  const matches = [];

  for (const group of groups) {
    for (const message of group.messages) {
      const score = scoreMessage(message, queryTokens);
      if (score < 4) continue;

      matches.push({
        score,
        groupName: group.groupName,
        fileName: group.fileName,
        sender: message.sender,
        timestamp: message.timestamp,
        at: message.at,
        text: message.text,
        phone: extractPhoneFromText(message.text),
        contactHint: extractContactHints(message.text),
      });
    }
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return String(right.at || "").localeCompare(String(left.at || ""));
  });

  return matches.slice(0, maxResults);
}

export function formatGroupIntelligenceForPrompt(snippets) {
  if (!snippets.length) {
    return "(No relevant group intelligence matches for this query.)";
  }

  return snippets
    .map((snippet, index) => {
      const excerpt = snippet.text.replace(/\s+/g, " ").trim().slice(0, 320);
      const contactLine = snippet.contactHint
        ? `Contact in message: ${snippet.contactHint}`
        : "Contact in message: none — secure group export only";

      return [
        `${index + 1}. Group: ${snippet.groupName}`,
        `   Sender display name: ${snippet.sender}`,
        `   When: ${snippet.timestamp}`,
        `   Excerpt: ${excerpt}`,
        `   ${contactLine}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function getGroupIntelligenceSummary(filePath) {
  const normalized = String(filePath).replace(/\\/g, "/");
  const fileName = normalized.split("/").pop() || "";
  const group = loadGroupTranscripts().find((entry) => entry.fileName === fileName);
  if (!group) {
    return "[WhatsApp group intelligence transcript — query-time search only]";
  }

  return `[WhatsApp group intelligence transcript]
Group name: ${group.groupName}
Actionable messages indexed: ${group.messages.length}
Use the GROUP INTELLIGENCE section in the prompt for relevant snippets. Full raw transcript is not loaded into context.`;
}

export function findGroupPosterMatches(nameQuery, limit = 3) {
  const query = String(nameQuery || "").trim().toLowerCase();
  if (!query) return [];

  const groups = loadGroupTranscripts();
  const matches = [];

  for (const group of groups) {
    for (const message of group.messages) {
      const sender = String(message.sender || "").toLowerCase();
      if (!sender.includes(query) && !query.includes(sender.replace(/^~\s*/, "").trim())) continue;
      matches.push({
        groupName: group.groupName,
        sender: message.sender,
        timestamp: message.timestamp,
        text: message.text,
        phone: extractPhoneFromText(message.text),
        contactHint: extractContactHints(message.text),
      });
    }
  }

  return matches.slice(0, limit);
}

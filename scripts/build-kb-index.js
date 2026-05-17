const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

/** [DD/MM/YYYY, H:MM(:SS)?] Sender: body (seconds optional) */
const WHATSAPP_HEADER_BRACKET =
  /^\[(\d{2}\/\d{2}\/\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s([^:]+):\s*(.*)$/;

/** DD/MM/YYYY, H:MM(:SS)? - Sender: body (brief export; seconds optional) */
const WHATSAPP_HEADER_DASH =
  /^(\d{2}\/\d{2}\/\d{4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+):\s*(.*)$/;

function parseWhatsAppMeta(content, filename) {
  const participants = new Set();
  const dates = [];
  const areas = new Set();
  const budgetMatches = [];

  const lines = String(content ?? "").replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const lineNorm = line.replace(/\r$/, "");
    let m = lineNorm.match(WHATSAPP_HEADER_BRACKET);
    if (!m) m = lineNorm.match(WHATSAPP_HEADER_DASH);
    if (!m) continue;

    dates.push(m[1]);
    const name = m[3].replace(/\s*\(Sterling Boulevard\)/, "");
    participants.add(name);
  }

  let match;

  const areaKeywords = [
    "JVC", "Dubai Marina", "Marina", "Meydan", "Business Bay", "Downtown",
    "JBR", "Dubai Hills", "JLT", "Damac Hills 2", "Damac Hills",
    "Arabian Ranches", "Creek Harbour", "Palm Jumeirah", "Palm",
    "Jumeirah", "Springs", "Meadows", "Sports City", "Town Square",
    "Al Raha", "Jebel Ali", "Discovery Gardens", "Abu Dhabi",
    "Emirates Hills", "Umm Suqeim", "Arabian Ranches 3"
  ];
  for (const area of areaKeywords) {
    if (content.includes(area)) areas.add(area);
  }

  const budgetPattern = /(?:budget|AED)\s*[\w\s]*?([\d,.]+[MK]?)/gi;
  while ((match = budgetPattern.exec(content)) !== null) {
    budgetMatches.push(match[1]);
  }

  const lastDate = dates.length > 0 ? dates[dates.length - 1] : null;

  return {
    participants: [...participants],
    areas: [...areas],
    lastActivity: lastDate,
    messageCount: dates.length,
  };
}

function extractSummary(content, type) {
  if (type === "whatsapp") {
    const lines = content.split("\n").filter((l) => l.trim());
    const first5 = lines.slice(0, 5).join(" ");
    return first5.substring(0, 300);
  }
  const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
  return lines.slice(0, 3).join(" ").substring(0, 300);
}

/**
 * Brief: `<agentId>_<leadName>_<timestamp>.txt` — parse from the right
 * (agentId may contain underscores). Timestamp must be plausible ms (new uploads).
 *
 * @returns {{ agentId: string, leadName: string, dateAdded: string } | null}
 */
function parseBriefWhatsappFilename(basename) {
  const base = String(basename).replace(/\.txt$/i, "");
  if (base.includes("__")) return null;
  const parts = base.split("_");
  if (parts.length < 3) return null;
  const tsStr = parts[parts.length - 1];
  if (!/^\d+$/.test(tsStr)) return null;
  const dateMs = Number(tsStr);
  if (!Number.isFinite(dateMs) || dateMs < 1e12) return null;
  const leadName = parts[parts.length - 2];
  if (!leadName) return null;
  const agentId = parts.slice(0, -2).join("_");
  if (!agentId) return null;
  return {
    agentId,
    leadName,
    dateAdded: new Date(dateMs).toISOString(),
  };
}

/**
 * Legacy: `<agentSlug>__<leadSlug>_<timestampMs>_<index>.txt`
 * @returns {{ agentId: string, dateAdded: string, leadName: null } | null}
 */
function parseLegacyDoubleUnderscoreFilename(basename) {
  const m = String(basename).match(/^(.+?)__(.+)_(\d+)_(\d+)\.txt$/i);
  if (!m) return null;
  const agentId = m[1];
  const dateMs = Number(m[3]);
  if (!Number.isFinite(dateMs)) return null;
  return {
    agentId,
    dateAdded: new Date(dateMs).toISOString(),
    leadName: null,
  };
}

/**
 * @returns {{ agentId: string, dateAdded: string, leadName: string | null } | null}
 */
function parseWhatsappUploadBasename(basename) {
  const b = String(basename);
  if (b.includes("__")) {
    const leg = parseLegacyDoubleUnderscoreFilename(basename);
    if (leg) return leg;
  }
  const brief = parseBriefWhatsappFilename(basename);
  if (brief) return brief;
  return parseLegacyDoubleUnderscoreFilename(basename);
}

function buildIndex() {
  const index = [];

  const whatsappDir = path.join(DATA_DIR, "whatsapp");
  if (fs.existsSync(whatsappDir)) {
    const files = fs.readdirSync(whatsappDir).filter((f) => f.endsWith(".txt")).sort();
    for (const file of files) {
      const filePath = path.join("data", "whatsapp", file);
      const absTxt = path.join(DATA_DIR, "whatsapp", file);
      const st = fs.statSync(absTxt);
      const content = fs.readFileSync(absTxt, "utf-8");
      const meta = parseWhatsAppMeta(content, file);
      const id = "whatsapp-" + file.replace(".txt", "");
      const parsed = parseWhatsappUploadBasename(file);
      index.push({
        id,
        file: filePath,
        path: filePath,
        type: "whatsapp",
        agentId: parsed ? parsed.agentId : null,
        leadName: parsed && parsed.leadName != null ? parsed.leadName : null,
        dateAdded: parsed ? parsed.dateAdded : st.mtime.toISOString(),
        summary: extractSummary(content, "whatsapp"),
        ...meta,
      });
    }
  }

  const webinarDir = path.join(DATA_DIR, "webinar");
  if (fs.existsSync(webinarDir)) {
    const files = fs.readdirSync(webinarDir).filter((f) => f.endsWith(".md")).sort();
    for (const file of files) {
      const filePath = path.join("data", "webinar", file);
      const content = fs.readFileSync(path.join(DATA_DIR, "webinar", file), "utf-8");
      const id = "webinar-" + file.replace(".md", "");
      index.push({
        id,
        file: filePath,
        type: "webinar",
        summary: extractSummary(content, "webinar"),
        participants: [],
        areas: [],
        lastActivity: null,
      });
    }
  }

  const emailsDir = path.join(DATA_DIR, "emails");
  if (fs.existsSync(emailsDir)) {
    const files = fs.readdirSync(emailsDir).filter((f) => f.endsWith(".md")).sort();
    for (const file of files) {
      const filePath = path.join("data", "emails", file);
      const content = fs.readFileSync(path.join(DATA_DIR, "emails", file), "utf-8");
      const id = "email-" + file.replace(".md", "");
      index.push({
        id,
        file: filePath,
        type: "email",
        summary: extractSummary(content, "email"),
        participants: [],
        areas: [],
        lastActivity: null,
      });
    }
  }

  const crmDir = path.join(DATA_DIR, "crm");
  if (fs.existsSync(crmDir)) {
    const files = fs.readdirSync(crmDir).filter((f) => f.endsWith(".jsonl")).sort();
    for (const file of files) {
      const absPath = path.join(crmDir, file);
      const filePath = path.join("data", "crm", file);
      const st = fs.statSync(absPath);
      const lines = fs.readFileSync(absPath, "utf-8").split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;

      let meta = null;
      const leadNames = [];
      const areas = new Set();
      let leadCount = 0;
      for (const line of lines) {
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj && obj.type === "crm-metadata") {
          meta = obj;
          continue;
        }
        if (obj && obj.type === "crm-lead") {
          leadCount++;
          if (typeof obj.name === "string" && obj.name.trim()) {
            leadNames.push(obj.name.trim());
          }
          if (typeof obj.area === "string" && obj.area.trim()) {
            areas.add(obj.area.trim());
          }
        }
      }

      const id = "crm-" + file.replace(".jsonl", "");
      const previewLeads = leadNames.slice(0, 5).join(", ");
      const summary =
        leadCount > 0
          ? `CRM import (${leadCount} lead${leadCount === 1 ? "" : "s"})${previewLeads ? `: ${previewLeads}${leadNames.length > 5 ? ", ..." : ""}` : ""}.`
          : "CRM import (no leads parsed).";

      index.push({
        id,
        file: filePath,
        path: filePath,
        type: "crm",
        agentId: meta?.agentId ?? null,
        agentName: meta?.agentName ?? null,
        originalFilename: meta?.originalFilename ?? null,
        dateAdded: meta?.importedAt ?? st.mtime.toISOString(),
        summary,
        participants: leadNames,
        leadCount,
        areas: [...areas],
        lastActivity: null,
      });
    }
  }

  const outputPath = path.join(DATA_DIR, "index.json");
  fs.writeFileSync(outputPath, JSON.stringify(index, null, 2));
  console.log(`Index built: ${index.length} documents indexed`);
  console.log(`Output: ${outputPath}`);
}

buildIndex();

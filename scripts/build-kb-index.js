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

function buildIndex() {
  const index = [];

  const whatsappDir = path.join(DATA_DIR, "whatsapp");
  if (fs.existsSync(whatsappDir)) {
    const files = fs.readdirSync(whatsappDir).filter((f) => f.endsWith(".txt")).sort();
    for (const file of files) {
      const filePath = path.join("data", "whatsapp", file);
      const content = fs.readFileSync(path.join(DATA_DIR, "whatsapp", file), "utf-8");
      const meta = parseWhatsAppMeta(content, file);
      const id = "whatsapp-" + file.replace(".txt", "");
      index.push({
        id,
        file: filePath,
        type: "whatsapp",
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

  const outputPath = path.join(DATA_DIR, "index.json");
  fs.writeFileSync(outputPath, JSON.stringify(index, null, 2));
  console.log(`Index built: ${index.length} documents indexed`);
  console.log(`Output: ${outputPath}`);
}

buildIndex();

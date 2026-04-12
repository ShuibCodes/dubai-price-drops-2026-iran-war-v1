const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function parseWhatsAppMeta(content, filename) {
  const participants = new Set();
  const dates = [];
  const areas = new Set();
  const budgetMatches = [];

  const messagePattern = /\[(\d{2}\/\d{2}\/\d{4}), \d{2}:\d{2}:\d{2}\] ([^:]+):/g;
  let match;
  while ((match = messagePattern.exec(content)) !== null) {
    dates.push(match[1]);
    const name = match[2].replace(/\s*\(Sterling Boulevard\)/, "");
    participants.add(name);
  }

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

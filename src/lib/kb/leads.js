import fs from "fs";
import path from "path";

const WHATSAPP_DIR = path.join(process.cwd(), "data", "whatsapp");

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function extractArea(content = "") {
  const preferredArea = content.match(/^Preferred Area:\s*(.+)$/im)?.[1];
  if (preferredArea) return clean(preferredArea);

  const leadContextArea = content.match(
    /^Lead Context:\s*Preferred listing area is\s+(.+?)(?:\s*\(|\.|$)/im
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

  return firstKnownArea ?? "Dubai";
}

export function getAllLeadContacts() {
  if (!fs.existsSync(WHATSAPP_DIR)) return [];

  const files = fs.readdirSync(WHATSAPP_DIR).filter((name) => name.toLowerCase().endsWith(".txt"));
  const leads = [];

  for (const fileName of files) {
    const fullPath = path.join(WHATSAPP_DIR, fileName);
    const content = fs.readFileSync(fullPath, "utf8");
    const headerName =
      content.match(/^Client Contact:\s*(.+?)\s*\|/im)?.[1] ||
      content.match(/^Lead Name:\s*(.+)$/im)?.[1];
    const phoneMatch = content.match(/WhatsApp:\s*([+0-9][0-9+\-\s]{6,})/i)?.[1];
    const email = content.match(/^Email:\s*([^\s]+@[^\s]+\.[^\s]+)$/im)?.[1] ?? null;
    const name = clean(headerName);
    const phone = clean(phoneMatch).replace(/\s+/g, " ");
    if (!name || !phone) continue;

    leads.push({
      name,
      normalizedName: normalizeName(name),
      firstName: normalizeName(name).split(" ")[0],
      phone,
      email,
      area: extractArea(content),
      fileName,
    });
  }

  return leads;
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
      lead.firstName === query
  );
  if (startsWith.length) return { matches: startsWith, leads };

  const contains = leads.filter(
    (lead) => lead.normalizedName.includes(query) || query.includes(lead.normalizedName)
  );
  return { matches: contains, leads };
}

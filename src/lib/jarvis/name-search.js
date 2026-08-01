/** Strip WhatsApp markdown / punctuation that breaks ilike name matches. */
export function cleanJarvisSearchName(name) {
  return String(name || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[*_~`]+/g, " ")
    .replace(/[%(),]/g, " ")
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_ALIASES = {
  shuayb: ["shuayb", "shuaib", "shoaib", "shuayib", "shuaieb"],
  shuaib: ["shuayb", "shuaib", "shoaib", "shuayib"],
  shoaib: ["shuayb", "shuaib", "shoaib"],
};

/** Expand a cleaned name into ilike terms (includes common spellings). */
export function jarvisNameSearchTerms(name) {
  const cleaned = cleanJarvisSearchName(name);
  if (!cleaned) return [];
  const first = cleaned.split(/\s+/)[0].toLowerCase();
  const aliases = NAME_ALIASES[first] || [first];
  const terms = new Set([cleaned, first, ...aliases]);
  return [...terms].filter(Boolean);
}

export function buildJarvisNameOrFilter(terms) {
  const parts = [];
  for (const term of terms) {
    const safe = String(term).replace(/[%_,()]/g, " ").trim();
    if (!safe) continue;
    parts.push(`push_name.ilike.%${safe}%`);
    parts.push(`inferred_name.ilike.%${safe}%`);
    parts.push(`source.ilike.%${safe}%`);
  }
  return parts.join(",");
}

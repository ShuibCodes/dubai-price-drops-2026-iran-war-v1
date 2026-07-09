const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

const STRIP_PHRASES = [
  "video ads",
  "open houses",
  "open house",
  "lead form",
  "campaign",
];

// Leftover single-token campaign noise after phrase stripping
const STRIP_WORDS = new Set(["launch", "ads", "video", "form", "house", "houses"]);

const MONTH_NAMES =
  "january|february|march|april|may|june|july|august|september|october|november|december";

function stripEmojis(text) {
  return String(text || "").replace(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E0}-\u{1F1FF}]/gu,
    ""
  );
}

function stripDates(text) {
  let out = String(text || "");
  // 10/06/26, 10-06-26, 10.06.2026
  out = out.replace(/\b\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4}\b/gi, " ");
  // June 2026, June 26, Jun 2026
  out = out.replace(
    new RegExp(`\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,4}\\b`, "gi"),
    " "
  );
  // standalone year 20xx
  out = out.replace(/\b20\d{2}\b/g, " ");
  return out;
}

function stripPhrases(text) {
  let out = String(text || "");
  for (const phrase of STRIP_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "gi");
    out = out.replace(re, " ");
  }
  return out;
}

/**
 * Deterministic campaign topic from Meta ad/form names.
 * Returns the first 1-3 remaining capitalized words after cleanup.
 */
export function extractCampaignTopic(adName, formName) {
  const source = String(adName || "").trim() || String(formName || "").trim();
  if (!source) return "";

  let text = stripEmojis(source);
  text = stripDates(text);
  text = stripPhrases(text);
  // Separators → spaces
  text = text.replace(/[-|_–—·•]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  const words = text
    .split(" ")
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => !STRIP_WORDS.has(w.toLowerCase()))
    // Keep capitalized / title-case tokens (and all-caps brand tokens)
    .filter((w) => /^[A-Z]/.test(w));

  return words.slice(0, 3).join(" ");
}

function dubaiYmd(date) {
  const dubai = new Date(date.getTime() + DUBAI_OFFSET_MS);
  return {
    y: dubai.getUTCFullYear(),
    m: dubai.getUTCMonth(),
    d: dubai.getUTCDate(),
  };
}

/**
 * Relative time label for form submission, in Asia/Dubai calendar days.
 */
export function humanizeFormTime(createdTimeIso, now = new Date()) {
  if (!createdTimeIso) return "recently";
  const created = new Date(createdTimeIso);
  if (Number.isNaN(created.getTime())) return "recently";

  const nowDate = now instanceof Date ? now : new Date(now);
  const diffMs = nowDate.getTime() - created.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "recently";

  const thirtyMin = 30 * 60 * 1000;
  if (diffMs < thirtyMin) return "a few minutes ago";

  const createdDay = dubaiYmd(created);
  const nowDay = dubaiYmd(nowDate);
  if (
    createdDay.y === nowDay.y &&
    createdDay.m === nowDay.m &&
    createdDay.d === nowDay.d
  ) {
    return "earlier today";
  }

  const yesterday = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000);
  const yDay = dubaiYmd(yesterday);
  if (
    createdDay.y === yDay.y &&
    createdDay.m === yDay.m &&
    createdDay.d === yDay.d
  ) {
    return "yesterday";
  }

  return "recently";
}

export function normalizeOwnsProperty(v) {
  const raw = String(v ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (["yes", "y", "true", "1", "own", "owns", "owner"].includes(raw)) return "yes";
  if (["no", "n", "false", "0", "rent", "renter", "tenant"].includes(raw)) return "no";
  if (raw === "yes" || raw.startsWith("yes")) return "yes";
  if (raw === "no" || raw.startsWith("no")) return "no";
  return "";
}

export function isMetaInstantFormSource(fields = {}) {
  const source = String(fields.client_source || fields.source || "").trim();
  return source.toLowerCase() === "meta instant form";
}

/** Enrich lead source with ad/form names when present. */
export function buildLeadSourceWithMeta(fields = {}, baseSource) {
  const adName = String(fields.ad_name || "").trim();
  const formName = String(fields.form_name || "").trim();
  const bits = [adName, formName].filter(Boolean);
  if (!bits.length) return baseSource;
  const suffix = bits.join(" / ");
  return baseSource ? `${baseSource} — ${suffix}` : suffix;
}

export function buildMetaFormVariables(fields = {}, now = new Date()) {
  if (!isMetaInstantFormSource(fields)) {
    return { campaignTopic: "", formWhen: "", ownsProperty: "" };
  }
  return {
    campaignTopic: extractCampaignTopic(fields.ad_name, fields.form_name),
    formWhen: humanizeFormTime(fields.created_time, now),
    ownsProperty: normalizeOwnsProperty(fields.owns_property),
  };
}

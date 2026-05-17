import Papa from "papaparse";

/**
 * @typedef {{
 *   name: string,
 *   phone: string | null,
 *   email: string | null,
 *   area: string | null,
 *   budget: number | null,
 *   budgetRaw: string | null,
 *   bedrooms: string | null,
 *   lastContact: string | null,
 *   status: string | null,
 *   notes: string | null,
 *   extra: Record<string, string>
 * }} CrmLeadRecord
 */

/**
 * @typedef {{
 *   records: CrmLeadRecord[],
 *   errors: { row: number, message: string }[],
 *   headerMap: Record<string, string>,
 *   unmappedHeaders: string[],
 *   rowsTotal: number,
 *   rowsImported: number,
 *   rowsSkipped: number
 * }} CrmCsvParseResult
 */

/** Canonical field → list of accepted header aliases (lowercase, alnum). */
const HEADER_ALIASES = {
  name: ["name", "fullname", "leadname", "clientname", "contactname", "customer", "customername"],
  phone: ["phone", "mobile", "whatsapp", "phonenumber", "mobilenumber", "contact", "tel", "telephone", "cell"],
  email: ["email", "emailaddress", "mail"],
  area: ["area", "location", "preferredarea", "community", "neighborhood", "neighbourhood", "region"],
  budget: ["budget", "budgetaed", "maxbudget", "price", "pricerange", "budgetrange"],
  bedrooms: ["bedrooms", "beds", "bed", "br", "bedroom", "bedcount"],
  lastContact: ["lastcontact", "lastcontacted", "lastinteraction", "lastactivity", "lasttouch"],
  status: ["status", "leadstatus", "stage", "pipelinestage"],
  notes: ["notes", "remarks", "description", "comments", "note"],
};

/** Required canonical fields. */
const REQUIRED_FIELDS = ["name"];

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeHeaderKey(raw) {
  return String(raw ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * @param {string[]} rawHeaders
 * @returns {{ map: Record<string, string>, unmapped: string[] }}
 */
function buildHeaderMap(rawHeaders) {
  /** @type {Record<string, string>} */
  const map = {};
  /** @type {string[]} */
  const unmapped = [];
  const usedCanonical = new Set();

  for (const raw of rawHeaders) {
    if (typeof raw !== "string") {
      unmapped.push(String(raw ?? ""));
      continue;
    }
    const key = normalizeHeaderKey(raw);
    if (!key) {
      unmapped.push(raw);
      continue;
    }

    let matched = null;
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (usedCanonical.has(canonical)) continue;
      if (aliases.includes(key)) {
        matched = canonical;
        break;
      }
    }

    if (matched) {
      map[raw] = matched;
      usedCanonical.add(matched);
    } else {
      unmapped.push(raw);
    }
  }

  return { map, unmapped };
}

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizePhone(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  return hasPlus ? `+${digits}` : digits;
}

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizeEmail(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
function normalizeBudget(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const cleaned = s
    .replace(/aed/gi, "")
    .replace(/dhs?/gi, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();

  const match = cleaned.match(/^([0-9]*\.?[0-9]+)([mk]?)$/i);
  if (!match) {
    const fallback = Number(cleaned);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  const suffix = match[2].toLowerCase();
  if (suffix === "m") return Math.round(base * 1_000_000);
  if (suffix === "k") return Math.round(base * 1_000);
  return Math.round(base);
}

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function trimToNullable(raw) {
  const s = String(raw ?? "").trim();
  return s ? s : null;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, string>} headerMap
 * @param {string} canonical
 * @returns {unknown}
 */
function getField(row, headerMap, canonical) {
  for (const [raw, canon] of Object.entries(headerMap)) {
    if (canon === canonical) return row[raw];
  }
  return undefined;
}

/**
 * @param {string} csvText
 * @returns {CrmCsvParseResult}
 */
export function parseCrmCsv(csvText) {
  const text = typeof csvText === "string" ? csvText : "";

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => (typeof h === "string" ? h.trim() : ""),
  });

  /** @type {{ row: number, message: string }[]} */
  const errors = [];

  for (const err of parsed.errors || []) {
    errors.push({
      row: typeof err.row === "number" ? err.row + 2 : 0,
      message: err.message || "CSV parse error",
    });
  }

  const rawHeaders = Array.isArray(parsed.meta?.fields) ? parsed.meta.fields : [];
  const { map: headerMap, unmapped } = buildHeaderMap(rawHeaders);

  const canonicalsFound = new Set(Object.values(headerMap));
  for (const required of REQUIRED_FIELDS) {
    if (!canonicalsFound.has(required)) {
      errors.push({
        row: 0,
        message: `Missing required column "${required}". Accepted headers: ${HEADER_ALIASES[required].join(", ")}.`,
      });
    }
  }

  /** @type {CrmLeadRecord[]} */
  const records = [];
  let rowsTotal = 0;
  let rowsSkipped = 0;

  if (errors.some((e) => e.row === 0 && e.message.startsWith("Missing required column"))) {
    return {
      records,
      errors,
      headerMap,
      unmappedHeaders: unmapped,
      rowsTotal,
      rowsImported: 0,
      rowsSkipped: 0,
    };
  }

  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    rowsTotal++;

    const rowNumber = i + 2;

    const name = trimToNullable(getField(row, headerMap, "name"));
    if (!name) {
      rowsSkipped++;
      errors.push({
        row: rowNumber,
        message: "Skipped: missing name.",
      });
      continue;
    }

    const phone = normalizePhone(getField(row, headerMap, "phone"));
    const email = normalizeEmail(getField(row, headerMap, "email"));
    const area = trimToNullable(getField(row, headerMap, "area"));
    const budgetRaw = trimToNullable(getField(row, headerMap, "budget"));
    const budget = budgetRaw == null ? null : normalizeBudget(budgetRaw);
    const bedrooms = trimToNullable(getField(row, headerMap, "bedrooms"));
    const lastContact = trimToNullable(getField(row, headerMap, "lastContact"));
    const status = trimToNullable(getField(row, headerMap, "status"));
    const notes = trimToNullable(getField(row, headerMap, "notes"));

    /** @type {Record<string, string>} */
    const extra = {};
    for (const raw of unmapped) {
      const v = trimToNullable(row[raw]);
      if (v != null) extra[raw] = v;
    }

    records.push({
      name,
      phone,
      email,
      area,
      budget,
      budgetRaw,
      bedrooms,
      lastContact,
      status,
      notes,
      extra,
    });
  }

  return {
    records,
    errors,
    headerMap,
    unmappedHeaders: unmapped,
    rowsTotal,
    rowsImported: records.length,
    rowsSkipped,
  };
}

export function getCanonicalHeaderExamples() {
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([canon, aliases]) => [canon, aliases[0]]),
  );
}

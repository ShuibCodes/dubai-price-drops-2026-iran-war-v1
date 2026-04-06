import * as cheerio from "cheerio";

const HEADING_VARIANTS = [
  "transaction history",
  "transactions history",
  "similar property transactions",
  "past transactions",
  "recent transactions",
];

function matchesHeading(text) {
  const normalized = text.toLowerCase().trim();
  return HEADING_VARIANTS.some(
    (variant) => normalized.includes(variant)
  );
}

function parsePrice(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9.]/g, "");
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function parseArea(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9.]/g, "");
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function normalizeDate(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString().slice(0, 10);
}

function extractRowsFromTable($, table) {
  const rows = [];
  const headers = [];

  $(table)
    .find("thead th, thead td, tr:first-child th, tr:first-child td")
    .each((_, cell) => {
      headers.push($(cell).text().trim().toLowerCase());
    });

  const dateIdx = headers.findIndex(
    (h) => h.includes("date") || h.includes("when")
  );
  const areaIdx = headers.findIndex(
    (h) => h.includes("area") || h.includes("sqft") || h.includes("size")
  );
  const priceIdx = headers.findIndex(
    (h) => h.includes("price") || h.includes("amount") || h.includes("aed")
  );

  const bodyRows = $(table).find("tbody tr");
  const allRows = bodyRows.length ? bodyRows : $(table).find("tr").slice(1);

  allRows.each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get();

    if (cells.length < 2) return;

    const date = normalizeDate(cells[dateIdx >= 0 ? dateIdx : 0]);
    const areaSqft = parseArea(cells[areaIdx >= 0 ? areaIdx : 1]);
    const priceAed = parsePrice(cells[priceIdx >= 0 ? priceIdx : cells.length - 1]);

    if (date || areaSqft || priceAed) {
      rows.push({ date, areaSqft, priceAed });
    }
  });

  return rows;
}

function extractRowsFromList($, container) {
  const rows = [];

  $(container)
    .find("li, [class*='transaction'], [class*='row'], [data-testid*='transaction']")
    .each((_, el) => {
      const text = $(el).text();
      const priceMatch = text.match(/(?:AED|aed)\s*[\d,]+/);
      const areaMatch = text.match(/[\d,]+\s*(?:sq\.?\s*ft|sqft)/i);
      const dateMatch = text.match(
        /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i
      );

      const priceAed = priceMatch ? parsePrice(priceMatch[0]) : null;
      const areaSqft = areaMatch ? parseArea(areaMatch[0]) : null;
      const date = dateMatch ? normalizeDate(dateMatch[0]) : null;

      if (priceAed || areaSqft || date) {
        rows.push({ date, areaSqft, priceAed });
      }
    });

  return rows;
}

function extractFromBayutState(html) {
  const match = html.match(/window\.state\s*=\s*(\{.*?\});/s);
  if (!match) return { rows: [], isCaptcha: false };

  let state;
  try {
    state = JSON.parse(match[1]);
  } catch {
    return { rows: [], isCaptcha: false };
  }

  const isCaptcha = state?.rendering?.page === "captchaChallenge";

  const txMap = state?.propertySimilarTransactions?.transactionsMap;
  if (!txMap || typeof txMap !== "object") return { rows: [], isCaptcha };

  const rows = [];
  for (const entries of Object.values(txMap)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      rows.push({
        date: normalizeDate(entry.date ?? entry.transactionDate ?? null),
        areaSqft: parseArea(String(entry.area ?? entry.size ?? "")),
        priceAed: parsePrice(String(entry.price ?? entry.amount ?? "")),
      });
    }
  }

  return { rows, isCaptcha };
}

export function parseTransactions(html) {
  const bayut = extractFromBayutState(html);
  if (bayut.rows.length > 0) return { rows: bayut.rows, isCaptcha: false };
  if (bayut.isCaptcha) return { rows: [], isCaptcha: true };

  const $ = cheerio.load(html);
  let rows = [];

  $("h1, h2, h3, h4, h5, h6, [class*='heading'], [class*='title'], [role='heading']").each(
    (_, heading) => {
      if (rows.length > 0) return;

      const headingText = $(heading).text();
      if (!matchesHeading(headingText)) return;

      const section =
        $(heading).closest("section, [class*='transaction'], [class*='section']") ||
        $(heading).parent();

      const table = section.find("table").first();
      if (table.length) {
        rows = extractRowsFromTable($, table);
        return;
      }

      let sibling = $(heading).next();
      for (let i = 0; i < 5 && sibling.length && rows.length === 0; i++) {
        if (sibling.is("table")) {
          rows = extractRowsFromTable($, sibling);
        } else if (sibling.find("table").length) {
          rows = extractRowsFromTable($, sibling.find("table").first());
        } else {
          rows = extractRowsFromList($, sibling);
        }
        sibling = sibling.next();
      }
    }
  );

  if (rows.length === 0) {
    $("table").each((_, table) => {
      if (rows.length > 0) return;

      const tableText = $(table).text().toLowerCase();
      if (
        tableText.includes("transaction") ||
        tableText.includes("sale") ||
        tableText.includes("sold")
      ) {
        rows = extractRowsFromTable($, table);
      }
    });
  }

  return { rows, isCaptcha: false };
}

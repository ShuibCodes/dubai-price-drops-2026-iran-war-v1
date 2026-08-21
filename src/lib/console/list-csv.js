import PapaImport from "papaparse";

function papa() {
  const lib = PapaImport?.parse ? PapaImport : PapaImport?.default || PapaImport;
  if (typeof lib?.parse !== "function") {
    throw new Error("CSV parser failed to load.");
  }
  return lib;
}

function canon(header) {
  return String(header || "")
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function looksLikePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

export function looksLikeName(value) {
  const text = String(value || "").trim();
  if (!text || looksLikePhone(text) || /@/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/^\d+([.,]\d+)?$/.test(text)) return false;
  return (
    /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF]/.test(text) &&
    text.length <= 80
  );
}

export function isSpreadsheetFile(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return false;
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".ods")) {
    return true;
  }
  const type = String(file?.type || "");
  return /spreadsheetml|application\/vnd\.ms-excel/.test(type) && !/csv/i.test(type);
}

export async function readFileText(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function sampleRows(rows, limit = 40) {
  return rows.filter((row) => row && typeof row === "object").slice(0, limit);
}

function headerHint(header, kind) {
  const key = canon(header);
  if (!key) return 0;
  if (kind === "phone") {
    if (
      /(phone|mobile|whatsapp|waid|tel|cell|msisdn|contactno|phoneno)/.test(key)
    ) {
      return 3;
    }
    if (key === "number" || key === "contact" || key === "wa") return 1;
    return 0;
  }
  if (/(firstname|lastname|surname|fullname|pushname|leadname|clientname|contactname|customername)/.test(key)) {
    return 3;
  }
  if (key === "name" || key === "customer" || key === "client" || key === "contact") {
    return 2;
  }
  return 0;
}

function scoreColumns(rows, headers) {
  const sample = sampleRows(rows);
  return headers.map((header) => {
    let filled = 0;
    let phoneHits = 0;
    let nameHits = 0;
    for (const row of sample) {
      const value = row?.[header];
      if (value == null || String(value).trim() === "") continue;
      filled += 1;
      if (looksLikePhone(value)) phoneHits += 1;
      if (looksLikeName(value)) nameHits += 1;
    }
    return {
      header,
      filled,
      phoneScore: phoneHits * 4 + headerHint(header, "phone"),
      nameScore: nameHits * 4 + headerHint(header, "name"),
      phoneHits,
      nameHits,
    };
  });
}

function pickPhoneHeader(scores) {
  const ranked = [...scores].sort((a, b) => b.phoneScore - a.phoneScore);
  const best = ranked[0];
  if (!best) return null;
  if (best.phoneHits > 0 || headerHint(best.header, "phone") >= 3) return best.header;
  return null;
}

function pickNameHeaders(scores, phoneHeader) {
  const ranked = [...scores]
    .filter((item) => item.header !== phoneHeader)
    .sort((a, b) => b.nameScore - a.nameScore);
  const usable = ranked.filter(
    (item) => item.nameHits > 0 || headerHint(item.header, "name") >= 2
  );
  if (!usable.length) return [];
  const first = usable[0];
  const key = canon(first.header);
  if (key === "firstname" || key === "first") {
    const last = usable.find((item) => {
      const k = canon(item.header);
      return k === "lastname" || k === "last" || k === "surname";
    });
    return last ? [first.header, last.header] : [first.header];
  }
  return [first.header];
}

function cellName(row, headers) {
  const parts = headers
    .map((header) => String(row?.[header] || "").trim())
    .filter(Boolean);
  return parts.join(" ").trim();
}

function phoneFromAnyCell(row) {
  for (const value of Object.values(row || {})) {
    if (looksLikePhone(value)) return String(value).trim();
  }
  return "";
}

function nameFromAnyCell(row, phone) {
  for (const value of Object.values(row || {})) {
    const text = String(value || "").trim();
    if (!text || text === phone || looksLikePhone(text)) continue;
    if (looksLikeName(text)) return text;
  }
  return "";
}

function contactsFromObjects(rows, headers) {
  const scores = scoreColumns(rows, headers);
  const phoneHeader = pickPhoneHeader(scores);
  const nameHeaders = pickNameHeaders(scores, phoneHeader);
  const contacts = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const phone = phoneHeader
      ? String(row[phoneHeader] || "").trim() || phoneFromAnyCell(row)
      : phoneFromAnyCell(row);
    if (!looksLikePhone(phone)) continue;
    const name = nameHeaders.length
      ? cellName(row, nameHeaders) || nameFromAnyCell(row, phone)
      : nameFromAnyCell(row, phone);
    contacts.push({ phone, name });
  }
  return contacts;
}

function contactsFromArrays(rows) {
  const contacts = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const phoneCell = row.find((cell) => looksLikePhone(cell));
    if (!phoneCell) continue;
    const nameCell = row.find(
      (cell) => looksLikeName(cell) && String(cell).trim() !== String(phoneCell).trim()
    );
    contacts.push({
      phone: String(phoneCell).trim(),
      name: nameCell ? String(nameCell).trim() : "",
    });
  }
  return contacts;
}

function headersLookLikeData(headers) {
  if (!headers.length) return false;
  const phoneish = headers.filter((header) => looksLikePhone(header)).length;
  const nameish = headers.filter((header) => looksLikeName(header)).length;
  if (phoneish && (nameish || headers.length <= 3)) return true;
  if (phoneish === headers.length) return true;
  return false;
}

export function contactsFromCsvText(text) {
  const Papa = papa();
  const withHeader = Papa.parse(String(text || ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => String(header || "").replace(/^\uFEFF/, "").trim(),
  });
  const headers = (withHeader.meta?.fields || []).filter(Boolean);
  const raw = Papa.parse(String(text || ""), {
    header: false,
    skipEmptyLines: "greedy",
  });
  const fromHeader = headersLookLikeData(headers)
    ? []
    : contactsFromObjects(withHeader.data || [], headers);
  const contacts = fromHeader.length
    ? fromHeader
    : contactsFromArrays(raw.data || []);
  return {
    contacts,
    headers: fromHeader.length ? headers : [],
    parseError: withHeader.errors?.[0]?.message || "",
  };
}

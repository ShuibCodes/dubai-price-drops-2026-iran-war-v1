import PapaImport from "papaparse";

const PHONE_KEYS = new Set([
  "phone",
  "mobile",
  "whatsapp",
  "phonenumber",
  "mobilenumber",
  "contact",
  "tel",
  "telephone",
  "cell",
  "waid",
  "wa",
  "clientphone",
  "phoneno",
  "number",
  "msisdn",
  "whatsappnumber",
  "mobilephone",
  "cellphone",
  "contactnumber",
  "phone1",
  "mobile1",
]);

const NAME_KEYS = new Set([
  "name",
  "fullname",
  "leadname",
  "clientname",
  "contactname",
  "customer",
  "customername",
  "pushname",
  "firstname",
]);

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

function looksLikePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
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

function pickFromRow(row, keys) {
  for (const [header, value] of Object.entries(row || {})) {
    if (keys.has(canon(header))) return String(value || "").trim();
  }
  return "";
}

function phoneFromAnyCell(row) {
  for (const value of Object.values(row || {})) {
    if (looksLikePhone(value)) return String(value).trim();
  }
  return "";
}

function nameFromRow(row) {
  const first = pickFromRow(row, new Set(["firstname"]));
  const last = pickFromRow(row, new Set(["lastname", "surname"]));
  return pickFromRow(row, NAME_KEYS) || [first, last].filter(Boolean).join(" ");
}

function contactsFromObjects(rows) {
  const contacts = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const headerPhone = Object.keys(row).find((header) => looksLikePhone(header));
    const phone = pickFromRow(row, PHONE_KEYS) || phoneFromAnyCell(row) || headerPhone || "";
    if (!phone || !looksLikePhone(phone)) continue;
    contacts.push({ phone, name: nameFromRow(row) });
  }
  return contacts;
}

function contactsFromArrays(rows) {
  const contacts = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const phoneCell = row.find((cell) => looksLikePhone(cell));
    if (!phoneCell) continue;
    const nameCell = row.find((cell) => String(cell || "").trim() && !looksLikePhone(cell));
    contacts.push({
      phone: String(phoneCell).trim(),
      name: nameCell ? String(nameCell).trim() : "",
    });
  }
  return contacts;
}

export function contactsFromCsvText(text) {
  const Papa = papa();
  const withHeader = Papa.parse(String(text || ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => String(header || "").replace(/^\uFEFF/, "").trim(),
  });
  let contacts = contactsFromObjects(withHeader.data || []);
  if (!contacts.length) {
    const raw = Papa.parse(String(text || ""), {
      header: false,
      skipEmptyLines: "greedy",
    });
    contacts = contactsFromArrays(raw.data || []);
  }
  return {
    contacts,
    headers: withHeader.meta?.fields || [],
    parseError: withHeader.errors?.[0]?.message || "",
  };
}

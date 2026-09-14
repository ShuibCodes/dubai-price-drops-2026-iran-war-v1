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

const ISO_ALPHA2 = new Set(
  "ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws xk ye yt za zm zw".split(
    " "
  )
);

const NAME_HEADER_BLOCKLIST = new Set([
  "cc",
  "clientsource",
  "contactid",
  "country",
  "countrycode",
  "countryiso",
  "email",
  "emailaddress",
  "emails",
  "id",
  "iso",
  "iso2",
  "iso3",
  "label",
  "labels",
  "leadid",
  "mail",
  "nationality",
  "recordid",
  "source",
  "status",
  "tag",
  "tags",
  "userid",
  "uuid",
]);

export function looksLikePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

export function looksLikeCountryCode(value) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z]{2}$/.test(text)) return false;
  if (!ISO_ALPHA2.has(text.toLowerCase())) return false;
  return text === text.toUpperCase() || text === text.toLowerCase();
}

function looksLikeRecordId(value) {
  const text = String(value || "").trim();
  if (/\s/.test(text) || text.length < 10 || text.length > 64) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return false;
  if (/[A-Za-z]/.test(text) && /\d/.test(text)) return true;
  return text.length >= 16 && /[a-z]/.test(text) && /[A-Z]/.test(text);
}

function looksLikeTagCell(value) {
  return /^[A-Za-z][\w -]*:/.test(String(value || "").trim());
}

export function looksLikeName(value) {
  const text = String(value || "").trim();
  if (!text || looksLikePhone(text) || /@/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/^\d+([.,]\d+)?$/.test(text)) return false;
  if (looksLikeCountryCode(text) || looksLikeRecordId(text) || looksLikeTagCell(text)) {
    return false;
  }
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
  if (NAME_HEADER_BLOCKLIST.has(key)) return -8;
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
      nameScore: nameHits * 4 + headerHint(header, "name") * 20,
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
  const candidates = scores.filter((item) => {
    if (item.header === phoneHeader) return false;
    return headerHint(item.header, "name") >= 0;
  });
  const hinted = candidates.filter((item) => headerHint(item.header, "name") >= 2);
  const ranked = [...(hinted.length ? hinted : candidates)].sort(
    (a, b) => b.nameScore - a.nameScore
  );
  const usable = ranked.filter(
    (item) => item.nameHits > 0 || headerHint(item.header, "name") >= 2
  );
  if (!usable.length) return [];
  const firstName = usable.find((item) => {
    const k = canon(item.header);
    return k === "firstname" || k === "first";
  });
  const lastName = usable.find((item) => {
    const k = canon(item.header);
    return k === "lastname" || k === "last" || k === "surname";
  });
  if (firstName) {
    return lastName ? [firstName.header, lastName.header] : [firstName.header];
  }
  return [usable[0].header];
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
      ? cellName(row, nameHeaders)
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

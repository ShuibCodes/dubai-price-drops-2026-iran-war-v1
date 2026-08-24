/**
 * Refresh DLD sales CSV for the dashboard timeline.
 * Usage: node scripts/refresh-dld-transactions.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ENDPOINT = "https://gateway.dubailand.gov.ae/open-data/transactions";
const TAKE = 1000;
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "transaction db",
  "transactions-pre-vs-post-war.csv"
);
const COLS = [
  "TRANSACTION_NUMBER",
  "INSTANCE_DATE",
  "GROUP_EN",
  "PROCEDURE_EN",
  "IS_OFFPLAN_EN",
  "IS_FREE_HOLD_EN",
  "USAGE_EN",
  "AREA_EN",
  "PROP_TYPE_EN",
  "PROP_SB_TYPE_EN",
  "TRANS_VALUE",
  "PROCEDURE_AREA",
  "ACTUAL_AREA",
  "ROOMS_EN",
  "PARKING",
  "NEAREST_METRO_EN",
  "NEAREST_MALL_EN",
  "NEAREST_LANDMARK_EN",
  "TOTAL_BUYER",
  "TOTAL_SELLER",
  "MASTER_PROJECT_EN",
  "PROJECT_EN",
];

function fmtUS(d) {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function csvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function instanceDate(raw) {
  const s = String(raw || "").replace("T", " ").trim();
  if (!s) return "";
  return s.length >= 19 ? s.slice(0, 19) : s;
}

function rowFromApi(item) {
  return {
    TRANSACTION_NUMBER: item.TRANSACTION_NUMBER ?? "",
    INSTANCE_DATE: instanceDate(item.INSTANCE_DATE),
    GROUP_EN: item.GROUP_EN ?? "",
    PROCEDURE_EN: item.PROCEDURE_EN ?? "",
    IS_OFFPLAN_EN: item.IS_OFFPLAN_EN ?? "",
    IS_FREE_HOLD_EN: item.IS_FREE_HOLD_EN ?? "",
    USAGE_EN: item.USAGE_EN ?? "",
    AREA_EN: item.AREA_EN ?? "",
    PROP_TYPE_EN: item.PROP_TYPE_EN ?? "",
    PROP_SB_TYPE_EN: item.PROP_SB_TYPE_EN ?? "",
    TRANS_VALUE: item.TRANS_VALUE ?? "",
    PROCEDURE_AREA: item.PROCEDURE_AREA ?? "",
    ACTUAL_AREA: item.ACTUAL_AREA ?? "",
    ROOMS_EN: item.ROOMS_EN ?? "",
    PARKING: item.PARKING ?? "",
    NEAREST_METRO_EN: item.NEAREST_METRO_EN ?? "",
    NEAREST_MALL_EN: item.NEAREST_MALL_EN ?? "",
    NEAREST_LANDMARK_EN: item.NEAREST_LANDMARK_EN ?? "",
    TOTAL_BUYER: item.TOTAL_BUYER ?? "",
    TOTAL_SELLER: item.TOTAL_SELLER ?? "",
    MASTER_PROJECT_EN: item.MASTER_PROJECT_EN ?? "",
    PROJECT_EN: item.PROJECT_EN ?? "",
  };
}

async function fetchPage(body, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "agentzero-dld-refresh/1.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (attempt < 6) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return fetchPage(body, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.responseCode !== 200) {
    throw new Error(`gateway ${json.responseCode}`);
  }
  return json.response?.result ?? [];
}

async function main() {
  const from = new Date(Date.UTC(2026, 1, 16));
  const to = new Date();
  const win = {
    P_FROM_DATE: fmtUS(from),
    P_TO_DATE: fmtUS(to),
    P_GROUP_ID: "1",
    P_IS_OFFPLAN: "",
    P_IS_FREE_HOLD: "",
    P_AREA_ID: "",
    P_USAGE_ID: "",
    P_PROP_TYPE_ID: "",
    P_SORT: "TRANSACTION_NUMBER_ASC",
  };

  const tmp = `${OUT}.tmp`;
  const out = fs.createWriteStream(tmp);
  out.write(`${COLS.join(",")}\n`);

  let skip = 0;
  let total = null;
  let kept = 0;
  while (total == null || skip < total) {
    const rows = await fetchPage({ ...win, P_TAKE: String(TAKE), P_SKIP: String(skip) });
    if (!rows.length) break;
    if (total == null) total = Number(rows[0].TOTAL) || rows.length;
    for (const item of rows) {
      if (String(item.GROUP_EN || "") !== "Sales") continue;
      const mapped = rowFromApi(item);
      if (!mapped.INSTANCE_DATE.slice(0, 10)) continue;
      out.write(`${COLS.map((c) => csvCell(mapped[c])).join(",")}\n`);
      kept += 1;
    }
    skip += rows.length;
    process.stdout.write(`fetched ${skip}/${total} kept ${kept}\n`);
    await new Promise((r) => setTimeout(r, 250));
  }

  await new Promise((resolve, reject) => {
    out.end((err) => (err ? reject(err) : resolve()));
  });
  fs.renameSync(tmp, OUT);
  console.log(`wrote ${kept} sales rows to ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

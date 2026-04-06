import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import Papa from "papaparse";

const WAR_START = "2026-03-15";

let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function parseRow(row) {
  const date = (row.INSTANCE_DATE || "").split(" ")[0];
  const amount = parseFloat(row.TRANS_VALUE) || 0;
  const size = parseFloat(row.ACTUAL_AREA) || 0;
  const rooms = (row.ROOMS_EN || "").trim();

  return {
    date,
    area: (row.AREA_EN || "").trim(),
    project: (row.PROJECT_EN || "").trim(),
    masterProject: (row.MASTER_PROJECT_EN || "").trim(),
    amount,
    size,
    pricePerSqft: size > 0 ? Math.round(amount / size) : 0,
    rooms,
    bedrooms: rooms === "Studio" ? 0 : parseInt(rooms) || null,
    subType: (row.PROP_SB_TYPE_EN || "").trim(),
    isOffplan: row.IS_OFFPLAN_EN === "Off-Plan",
    isFreehold: row.IS_FREE_HOLD_EN === "Free Hold",
    landmark: (row.NEAREST_LANDMARK_EN || "").trim(),
    metro: (row.NEAREST_METRO_EN || "").trim(),
    mall: (row.NEAREST_MALL_EN || "").trim(),
    period: date < WAR_START ? "pre" : "post",
  };
}

function buildAggregations(transactions) {
  const byArea = {};
  const byProject = {};
  const byDate = {};
  const byRooms = {};
  const bySubType = {};
  let totalValue = 0;
  let preWarCount = 0;
  let postWarCount = 0;
  let preWarValue = 0;
  let postWarValue = 0;

  for (const t of transactions) {
    totalValue += t.amount;

    if (t.period === "pre") {
      preWarCount++;
      preWarValue += t.amount;
    } else {
      postWarCount++;
      postWarValue += t.amount;
    }

    if (!byArea[t.area]) byArea[t.area] = { area: t.area, total: 0, count: 0, preCount: 0, postCount: 0, preTotal: 0, postTotal: 0 };
    byArea[t.area].total += t.amount;
    byArea[t.area].count += 1;
    if (t.period === "pre") { byArea[t.area].preCount++; byArea[t.area].preTotal += t.amount; }
    else { byArea[t.area].postCount++; byArea[t.area].postTotal += t.amount; }

    if (t.project) {
      if (!byProject[t.project]) byProject[t.project] = { project: t.project, total: 0, count: 0, preCount: 0, postCount: 0, preTotal: 0, postTotal: 0 };
      byProject[t.project].total += t.amount;
      byProject[t.project].count += 1;
      if (t.period === "pre") { byProject[t.project].preCount++; byProject[t.project].preTotal += t.amount; }
      else { byProject[t.project].postCount++; byProject[t.project].postTotal += t.amount; }
    }

    if (!byDate[t.date]) byDate[t.date] = { date: t.date, total: 0, count: 0, avgPrice: 0 };
    byDate[t.date].total += t.amount;
    byDate[t.date].count += 1;

    const roomKey = t.rooms || "Unknown";
    if (!byRooms[roomKey]) byRooms[roomKey] = { rooms: roomKey, total: 0, count: 0, avgPrice: 0 };
    byRooms[roomKey].total += t.amount;
    byRooms[roomKey].count += 1;

    if (t.subType) {
      if (!bySubType[t.subType]) bySubType[t.subType] = { type: t.subType, total: 0, count: 0 };
      bySubType[t.subType].total += t.amount;
      bySubType[t.subType].count += 1;
    }
  }

  const areaList = Object.values(byArea)
    .map((a) => ({ ...a, avg: Math.round(a.total / a.count), preAvg: a.preCount ? Math.round(a.preTotal / a.preCount) : 0, postAvg: a.postCount ? Math.round(a.postTotal / a.postCount) : 0 }))
    .sort((a, b) => b.count - a.count);

  const projectList = Object.values(byProject)
    .map((p) => ({ ...p, avg: Math.round(p.total / p.count), preAvg: p.preCount ? Math.round(p.preTotal / p.preCount) : 0, postAvg: p.postCount ? Math.round(p.postTotal / p.postCount) : 0 }))
    .sort((a, b) => b.count - a.count);

  const dateList = Object.values(byDate)
    .map((d) => ({ ...d, avgPrice: Math.round(d.total / d.count) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const roomsList = Object.values(byRooms)
    .map((r) => ({ ...r, avgPrice: Math.round(r.total / r.count) }))
    .sort((a, b) => b.count - a.count);

  const subTypeList = Object.values(bySubType)
    .map((s) => ({ ...s, avg: Math.round(s.total / s.count) }))
    .sort((a, b) => b.count - a.count);

  const scatter = transactions
    .filter((t) => t.size > 0 && t.amount > 0 && t.amount < 50_000_000)
    .sort(() => Math.random() - 0.5)
    .slice(0, 800)
    .map((t) => ({ size: t.size, amount: t.amount, rooms: t.rooms, area: t.area, project: t.project, period: t.period }));

  return {
    summary: {
      totalTransactions: transactions.length,
      totalValue,
      avgPrice: Math.round(totalValue / transactions.length),
      preWarCount,
      postWarCount,
      preWarAvg: preWarCount ? Math.round(preWarValue / preWarCount) : 0,
      postWarAvg: postWarCount ? Math.round(postWarValue / postWarCount) : 0,
      warStart: WAR_START,
    },
    byArea: areaList.slice(0, 30),
    byProject: projectList.slice(0, 30),
    timeline: dateList,
    byRooms: roomsList,
    bySubType: subTypeList,
    scatter,
  };
}

export async function GET() {
  try {
    const now = Date.now();
    if (cached && now - cachedAt < CACHE_TTL_MS) {
      return NextResponse.json(cached);
    }

    const csvPath = path.join(process.cwd(), "src", "lib", "transaction db", "transactions-pre-vs-post-war.csv");
    const raw = await fs.readFile(csvPath, "utf-8");
    const { data } = Papa.parse(raw, { header: true, skipEmptyLines: true });

    const transactions = data.map(parseRow).filter((t) => t.date && t.amount > 0);
    const result = buildAggregations(transactions);

    cached = result;
    cachedAt = now;

    return NextResponse.json(result);
  } catch (err) {
    console.error("transactions-csv API error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

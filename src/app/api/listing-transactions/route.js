import { NextResponse } from "next/server";
import { parseTransactions } from "@/lib/propertyfinder-transactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PLAYWRIGHT_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const ALLOWED_HOSTS = [
  "www.propertyfinder.ae",
  "propertyfinder.ae",
  "www.bayut.com",
  "bayut.com",
];

const responseCache = new Map();

function isAllowedUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return ALLOWED_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function fetchWithPlaywright(url) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PLAYWRIGHT_TIMEOUT_MS });

    await page.waitForSelector(
      'h2:has-text("Similar Property Transactions"), h2:has-text("Transaction History")',
      { timeout: 10_000 }
    ).catch(() => {});

    await page.waitForTimeout(2000);

    const rows = await page.evaluate(() => {
      const results = [];
      const headings = document.querySelectorAll("h2, h3, h4");
      let targetSection = null;

      for (const h of headings) {
        if (h.textContent.toLowerCase().includes("similar property transaction")) {
          targetSection = h.closest("section") || h.parentElement;
          break;
        }
      }

      if (!targetSection) return results;

      const cells = targetSection.querySelectorAll("table td, [role='cell'], [class*='cell'], [class*='row'] span, [class*='transaction'] span");

      if (cells.length >= 3) {
        const texts = Array.from(cells).map((c) => c.textContent.trim());
        for (let i = 0; i < texts.length - 2; i += 3) {
          const date = texts[i] || null;
          const areaRaw = texts[i + 1]?.replace(/[^0-9.]/g, "");
          const priceRaw = texts[i + 2]?.replace(/[^0-9.]/g, "");
          const areaSqft = areaRaw ? Math.round(Number(areaRaw)) || null : null;
          const priceAed = priceRaw ? Math.round(Number(priceRaw)) || null : null;
          if (date || areaSqft || priceAed) {
            results.push({ date, areaSqft, priceAed });
          }
        }
        return results;
      }

      const allText = targetSection.innerText;
      const lines = allText.split("\n").map((l) => l.trim()).filter(Boolean);
      const dateRe = /^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}$/i;

      for (let i = 0; i < lines.length; i++) {
        if (dateRe.test(lines[i])) {
          const date = lines[i];
          const areaRaw = (lines[i + 1] || "").replace(/[^0-9.]/g, "");
          const priceRaw = (lines[i + 2] || "").replace(/[^0-9.]/g, "");
          const areaSqft = areaRaw ? Math.round(Number(areaRaw)) || null : null;
          const priceAed = priceRaw ? Math.round(Number(priceRaw)) || null : null;
          if (date || areaSqft || priceAed) {
            results.push({ date, areaSqft, priceAed });
          }
          i += 2;
        }
      }

      return results;
    });

    return rows;
  } finally {
    await browser.close();
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";

  if (!url) {
    return NextResponse.json(
      { status: "error", rows: [], message: "URL is required", sourceUrl: "" },
      { status: 400 }
    );
  }

  if (!isAllowedUrl(url)) {
    return NextResponse.json(
      {
        status: "error",
        rows: [],
        message: "Only PropertyFinder and Bayut URLs are supported",
        sourceUrl: url,
      },
      { status: 400 }
    );
  }

  const cached = responseCache.get(url);
  if (cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  try {
    const rows = await fetchWithPlaywright(url);
    const fetchedAt = new Date().toISOString();

    const payload = {
      status: "ok",
      rows,
      sourceUrl: url,
      fetchedAt,
    };

    responseCache.set(url, { payload, fetchedAtMs: Date.now() });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({
      status: "error",
      rows: [],
      message: error.message ?? "Failed to fetch transaction history",
      sourceUrl: url,
    });
  }
}

import * as cheerio from "cheerio";

const DEFAULT_MAX_PAGES = 15;
const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (AgentZero Knowledge Bot; +https://agentzero.ae)";

const ASSET_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "svg",
  "webp",
  "pdf",
  "zip",
  "rar",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "mp4",
  "mp3",
  "css",
  "js",
  "json",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "eot",
]);

const IGNORED_PATH_PREFIXES = [
  "/wp-admin",
  "/wp-login",
  "/wp-content",
  "/wp-includes",
  "/cart",
  "/checkout",
  "/my-account",
  "/login",
  "/logout",
  "/register",
  "/signin",
  "/signup",
  "/cdn-cgi",
  "/feed",
  "/comments",
];

const HIGH_PRIORITY_KEYWORDS = [
  "about",
  "service",
  "services",
  "project",
  "projects",
  "property",
  "properties",
  "offplan",
  "off-plan",
  "team",
  "agents",
  "contact",
  "faq",
  "community",
  "communities",
  "developer",
  "developers",
  "why-us",
  "company",
  "dubai",
];

export function normalizeUrl(input) {
  if (!input || typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw) return null;

  // Reject unsupported protocols like file:, mailto:, tel:, javascript:, data:
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) && !/^https?:/i.test(raw)) {
    return null;
  }

  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    // Hostname must be valid and contain at least one dot (domain.tld) or localhost
    if (!u.hostname || (!u.hostname.includes(".") && u.hostname !== "localhost")) {
      return null;
    }
    u.hash = "";
    // Remove analytics / session search params
    const deleteParams = [];
    for (const [key] of u.searchParams.entries()) {
      if (/^(utm_|fbclid|gclid|_ga|_gl|ref)/i.test(key)) {
        deleteParams.push(key);
      }
    }
    for (const p of deleteParams) {
      u.searchParams.delete(p);
    }
    // Remove trailing slash for consistency (unless root /)
    let finalStr = u.toString();
    if (finalStr.endsWith("/")) {
      finalStr = finalStr.slice(0, -1);
    }
    return finalStr;
  } catch {
    return null;
  }
}

function getHostBase(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

export function isSameOrigin(urlA, urlB) {
  try {
    const uA = new URL(urlA);
    const uB = new URL(urlB);
    return getHostBase(uA.hostname) === getHostBase(uB.hostname);
  } catch {
    return false;
  }
}

export function isCrawlableUrl(candidateUrl, rootOriginUrl) {
  try {
    const u = new URL(candidateUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (!isSameOrigin(candidateUrl, rootOriginUrl)) return false;

    const pathname = u.pathname.toLowerCase();
    for (const prefix of IGNORED_PATH_PREFIXES) {
      if (pathname.startsWith(prefix)) return false;
    }

    const ext = pathname.split(".").pop();
    if (ext && ext !== pathname && ASSET_EXTENSIONS.has(ext)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function scoreUrl(url) {
  const path = url.toLowerCase();
  let score = 0;
  for (const kw of HIGH_PRIORITY_KEYWORDS) {
    if (path.includes(kw)) score += 10;
  }
  // Penalize deep path structures
  const slashCount = (path.match(/\//g) || []).length;
  score -= Math.max(0, slashCount - 3) * 2;
  return score;
}

function cleanHtmlText(html, pageUrl) {
  const $ = cheerio.load(html);

  // Strip noise elements
  $(
    "script, style, svg, noscript, iframe, form, button, " +
    "nav, footer, header, [role='navigation'], [role='banner'], " +
    "[role='contentinfo'], .nav, .navbar, .menu, .footer, .header, " +
    ".cookie-banner, .cookie-notice, .popup, .modal, .ad, .advertisement"
  ).remove();

  const title = $("title").first().text().trim() || "";
  const metaDesc =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";

  // Discover candidate links
  const foundLinks = new Set();
  $("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href");
    if (!rawHref) return;
    try {
      const resolved = new URL(rawHref, pageUrl).toString();
      const normalized = normalizeUrl(resolved);
      if (normalized) foundLinks.add(normalized);
    } catch {
      // Ignore malformed href
    }
  });

  // Extract core content elements
  let mainContent = $("main, article, #content, .content, #main, .main").text();
  if (!mainContent || mainContent.trim().length < 150) {
    mainContent = $("body").text();
  }

  // Clean whitespace: collapse sequential whitespace into single space/line
  const cleanedText = mainContent
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/[ \t]{2,}/g, " ");

  return {
    title,
    metaDesc,
    text: cleanedText,
    links: Array.from(foundLinks),
  };
}

async function fetchPageWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new Error(`Non-HTML content-type: ${contentType}`);
    }

    const html = await res.text();
    return html;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function renderWithPlaywrightFallback(url) {
  let playwrightModule;
  try {
    playwrightModule = await import("playwright");
  } catch {
    return null;
  }

  const { chromium } = playwrightModule;
  if (!chromium) return null;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
    // Wait briefly for hydration
    await page.waitForTimeout(1000);
    const html = await page.content();
    return html;
  } catch {
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function fetchSitemapUrls(rootUrl) {
  const sitemapUrls = [];
  try {
    const u = new URL(rootUrl);
    const sitemapTarget = `${u.origin}/sitemap.xml`;
    const res = await fetch(sitemapTarget, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return sitemapUrls;

    const xml = await res.text();
    const locMatches = xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi);
    for (const match of locMatches) {
      const loc = normalizeUrl(match[1]);
      if (loc && isCrawlableUrl(loc, rootUrl)) {
        sitemapUrls.push(loc);
      }
    }
  } catch {
    // Sitemap discovery is optional
  }
  return sitemapUrls;
}

/**
 * Crawls a website starting from rootUrl up to maxPages.
 *
 * @param {string} rootUrl - Website URL (e.g. "https://stageproperties.com")
 * @param {object} options
 * @param {number} [options.maxPages=15] - Maximum pages to crawl
 * @param {boolean} [options.singleUrlOnly=false] - Only crawl the given URL without following links
 * @param {(progress: { step: string, pagesCrawled: number, pagesFound: number, currentUrl: string }) => void} [options.onProgress]
 * @returns {Promise<{ rootUrl: string, pagesCrawled: number, pages: Array<{ url: string, title: string, metaDesc: string, text: string }>, aggregatedText: string }>}
 */
export async function crawlWebsite(rootUrl, {
  maxPages = DEFAULT_MAX_PAGES,
  singleUrlOnly = false,
  onProgress,
} = {}) {
  const normalizedRoot = normalizeUrl(rootUrl);
  if (!normalizedRoot) {
    throw new Error(`Invalid URL provided: ${rootUrl}`);
  }

  const queue = [normalizedRoot];
  const queueSet = new Set([normalizedRoot]);
  const visited = new Set();
  const pages = [];

  onProgress?.({
    step: "discovering_pages",
    pagesCrawled: 0,
    pagesFound: 1,
    currentUrl: normalizedRoot,
  });

  // If not single-url mode, check sitemap for top pages
  if (!singleUrlOnly) {
    const sitemapLinks = await fetchSitemapUrls(normalizedRoot);
    const sortedSitemap = sitemapLinks
      .filter((u) => !queueSet.has(u))
      .sort((a, b) => scoreUrl(b) - scoreUrl(a))
      .slice(0, 30);

    for (const link of sortedSitemap) {
      queue.push(link);
      queueSet.add(link);
    }
  }

  while (queue.length > 0 && pages.length < maxPages) {
    const currentUrl = queue.shift();
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    onProgress?.({
      step: "crawling_pages",
      pagesCrawled: pages.length,
      pagesFound: queue.length + pages.length + 1,
      currentUrl,
    });

    try {
      let html = await fetchPageWithTimeout(currentUrl).catch(() => null);

      // Playwright fallback for SPA if fetch failed or got almost nothing
      if (!html || html.length < 500) {
        const rendered = await renderWithPlaywrightFallback(currentUrl);
        if (rendered) html = rendered;
      }

      if (!html) continue;

      const extracted = cleanHtmlText(html, currentUrl);

      // If Cheerio text was too sparse (< 150 chars), attempt Playwright render once
      if (extracted.text.length < 150) {
        const rendered = await renderWithPlaywrightFallback(currentUrl);
        if (rendered) {
          const renderedExtracted = cleanHtmlText(rendered, currentUrl);
          if (renderedExtracted.text.length > extracted.text.length) {
            extracted.title = renderedExtracted.title || extracted.title;
            extracted.text = renderedExtracted.text;
            extracted.links = renderedExtracted.links;
          }
        }
      }

      if (extracted.text.length >= 80) {
        pages.push({
          url: currentUrl,
          title: extracted.title,
          metaDesc: extracted.metaDesc,
          text: extracted.text,
        });
      }

      // If singleUrlOnly, don't enqueue sub-pages
      if (!singleUrlOnly) {
        const newLinks = extracted.links
          .filter((link) => isCrawlableUrl(link, normalizedRoot))
          .filter((link) => !visited.has(link) && !queueSet.has(link));

        for (const link of newLinks) {
          queueSet.add(link);
          queue.push(link);
        }

        // Re-sort remaining queue by relevance score
        queue.sort((a, b) => scoreUrl(b) - scoreUrl(a));
      }

      // Small respectful delay between requests
      await new Promise((r) => setTimeout(r, 250));
    } catch {
      // Individual page failures are skipped so the rest of crawl succeeds
    }
  }

  // Aggregate pages into a clean compiled text payload for extraction
  // Limit aggregate to ~75,000 characters to keep well within LLM context
  let aggregatedText = "";
  for (const page of pages) {
    const block = [
      `=== PAGE: ${page.title || "Untitled"} (${page.url}) ===`,
      page.metaDesc ? `Summary: ${page.metaDesc}` : null,
      page.text.slice(0, 5000), // Cap per page to avoid a single huge page dominating
      "\n",
    ]
      .filter(Boolean)
      .join("\n");

    if (aggregatedText.length + block.length > 75000) break;
    aggregatedText += `${block}\n`;
  }

  return {
    rootUrl: normalizedRoot,
    pagesCrawled: pages.length,
    pages,
    aggregatedText: aggregatedText.trim(),
  };
}

import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_IMAGES = 4;
const MAX_MARKDOWN_CHARS = 22_000;

// Drop logos, UI chrome, and agent/broker headshots (not unit photos).
const IMAGE_SKIP_RE =
  /logo|icon|avatar|sprite|pixel|tracking|favicon|badge|button|placeholder|spinner|blank|1x1|spacer|emoji|flag|brand[-_]?mark|agent_image|\/agents?\/|\/brokers?\/|\/agenc(?:y|ies)\/|realtor|headshot|portrait|profile|user[-_/]|staff|seller|owner[-_]?photo|whatsapp|qr[-_]?code|map[-_]?pin|staticmap|\.svg(\?|$)/i;

// Actual media asset paths used by UAE portals for unit photos.
const UNIT_MEDIA_PATH_RE =
  /\/media\/images\/listing\/|\/property\/|\/listings?\/.+\/(images?|photos?)\/|bayutcdn|propertyfinder\.ae\/.*\.(jpe?g|png|webp|avif)|dubizzle/i;

const DEEP_LISTING_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    community: { type: "string" },
    subcommunity: { type: "string" },
    building: { type: "string" },
    price: { type: "string" },
    bedrooms: { type: ["number", "null"] },
    bathrooms: { type: ["number", "null"] },
    sizeSqft: { type: ["number", "null"] },
    propertyType: { type: "string" },
    furnishing: { type: "string" },
    parking: { type: "string" },
    serviceCharge: { type: "string" },
    floor: { type: "string" },
    view: { type: "string" },
    completionStatus: { type: "string" },
    developer: { type: "string" },
    yearBuilt: { type: "string" },
    ownership: { type: "string" },
    reraPermit: { type: "string" },
    paymentPlan: { type: "string" },
    nearby: {
      type: "array",
      items: { type: "string" },
    },
    amenities: {
      type: "array",
      items: { type: "string" },
    },
    highlights: {
      type: "array",
      items: { type: "string" },
    },
    description: { type: "string" },
  },
};

function clean(value) {
  return String(value ?? "").trim();
}

function asNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function asStringList(value, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(item).replace(/—/g, "-")).filter(Boolean).slice(0, limit);
}

function uniqueUrls(urls = []) {
  const seen = new Set();
  const out = [];
  for (const raw of urls) {
    const url = clean(raw);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const key = url.split("?")[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function isHtmlPageUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    // Portal listing/search HTML pages — never treat as images.
    if (/\.html?$/i.test(path)) return true;
    if (/\/(en|ar)\/(buy|rent|search|plp|property-for)\//i.test(path)) return true;
    if (!/\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(path) && !UNIT_MEDIA_PATH_RE.test(url)) {
      // No image extension and not a known media CDN path.
      if (/propertyfinder\.ae|bayut\.com|dubizzle\.com/i.test(parsed.hostname) &&
          !/static\.|cdn\.|images?\.|media\./i.test(parsed.hostname)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function looksLikeAgentPhoto(url, extraText = "") {
  const haystack = `${url} ${extraText}`.toLowerCase();
  if (/agent_image|\/agents?\/|\/brokers?\/|\/avatars?\//i.test(haystack)) return true;
  if (IMAGE_SKIP_RE.test(haystack)) return true;
  return false;
}

function looksLikePropertyImage(url, extraText = "") {
  const lower = String(url || "").toLowerCase();
  if (!lower || isHtmlPageUrl(lower)) return false;
  if (looksLikeAgentPhoto(lower, extraText)) return false;
  if (/\.(svg)(\?|$)/i.test(lower)) return false;

  // Hard yes: PF/Bayut listing media CDNs
  if (/\/media\/images\/listing\//i.test(lower)) return true;
  if (UNIT_MEDIA_PATH_RE.test(lower)) return true;

  // Otherwise only accept real image file URLs
  return /\.(jpe?g|png|webp|avif)(\?|$)/i.test(lower);
}

function scoreUnitImage(url) {
  const lower = url.toLowerCase();
  let score = 0;
  if (/\/media\/images\/listing\//i.test(lower)) score += 20;
  if (/static\.shared\.propertyfinder|bayutcdn|images\.bayut/i.test(lower)) score += 8;
  if (/1312x|1024x|800x|668x|large|original/i.test(lower)) score += 4;
  if (/400x400|100x100|64x64|agent_image/i.test(lower)) score -= 30;
  if (looksLikeAgentPhoto(url)) score -= 50;
  if (isHtmlPageUrl(url)) score -= 100;
  return score;
}

function collectImagesFromHtml(html, pageUrl) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const found = [];

  $("img").each((_, el) => {
    const $el = $(el);
    const alt = clean($el.attr("alt"));
    const className = clean($el.attr("class"));
    const aria = clean($el.attr("aria-label"));
    const context = `${alt} ${className} ${aria}`;

    // Only skip clear agent-avatar widgets — not any ancestor with "agent" in class
    // (that was wiping real gallery photos on Property Finder).
    const inAgentAvatar =
      $el.is('[class*="avatar"],[class*="AgentImage"],[data-testid*="agent-image"]') ||
      $el.parent().is('[class*="avatar"],[class*="agent-image"],[class*="AgentImage"]');
    if (inAgentAvatar) return;

    const candidates = [
      $el.attr("src"),
      $el.attr("data-src"),
      $el.attr("data-lazy-src"),
      $el.attr("data-original"),
      $el.attr("data-url"),
    ]
      .map((value) => clean(value))
      .filter(Boolean);

    const srcset = $el.attr("srcset") || $el.attr("data-srcset") || "";
    if (srcset) {
      srcset.split(",").forEach((part) => {
        const candidate = part.trim().split(/\s+/)[0];
        if (candidate) candidates.push(candidate);
      });
    }

    candidates.forEach((candidate) => {
      const absolute = absolutizeUrl(candidate, pageUrl);
      if (looksLikePropertyImage(absolute, context)) {
        found.push(absolute);
      }
    });
  });

  // og:image on PF/Bayut is almost always the unit hero, not the agent.
  $('meta[property="og:image"], meta[name="twitter:image"], meta[name="og:image"]').each(
    (_, el) => {
      const content = $(el).attr("content");
      if (content && looksLikePropertyImage(content)) {
        found.push(absolutizeUrl(content, pageUrl));
      }
    }
  );

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || "{}");
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        // Skip Person / RealEstateAgent JSON-LD image fields.
        const type = String(node?.["@type"] || "").toLowerCase();
        if (/person|agent|broker|organization|realestateagent/.test(type)) continue;

        const images = node?.image || node?.photo || node?.images;
        if (typeof images === "string" && looksLikePropertyImage(images)) {
          found.push(absolutizeUrl(images, pageUrl));
        }
        if (Array.isArray(images)) {
          images.forEach((img) => {
            if (typeof img === "string" && looksLikePropertyImage(img)) {
              found.push(absolutizeUrl(img, pageUrl));
            } else if (img?.url && looksLikePropertyImage(img.url)) {
              found.push(absolutizeUrl(img.url, pageUrl));
            } else if (img?.contentUrl && looksLikePropertyImage(img.contentUrl)) {
              found.push(absolutizeUrl(img.contentUrl, pageUrl));
            }
          });
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  });

  return uniqueUrls(found)
    .filter((url) => looksLikePropertyImage(url))
    .sort((a, b) => scoreUnitImage(b) - scoreUnitImage(a));
}

function absolutizeUrl(maybeRelative, baseUrl) {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return clean(maybeRelative);
  }
}

function collectImagesFromMetadata(metadata = {}) {
  const candidates = [
    metadata.ogImage,
    metadata["og:image"],
    metadata.twitterImage,
    metadata["twitter:image"],
    metadata.image,
  ];
  if (Array.isArray(metadata.images)) candidates.push(...metadata.images);
  return uniqueUrls(candidates.flat()).filter(looksLikePropertyImage);
}

function collectImagesFromMarkdown(markdown = "") {
  const matches = String(markdown).matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g);
  const urls = [];
  for (const match of matches) urls.push(match[1]);
  return uniqueUrls(urls).filter(looksLikePropertyImage);
}

function collectImagesFromLinks(links = []) {
  // Only keep actual image asset URLs — never related listing HTML pages.
  return uniqueUrls(links).filter(
    (url) => looksLikePropertyImage(url) && /\.(jpe?g|png|webp|avif)(\?|$)/i.test(url)
  );
}

function emptyDeepFields() {
  return {
    building: "",
    furnishing: "",
    parking: "",
    serviceCharge: "",
    floor: "",
    view: "",
    completionStatus: "",
    developer: "",
    yearBuilt: "",
    ownership: "",
    reraPermit: "",
    paymentPlan: "",
    nearby: [],
  };
}

function normalizeListingFields(raw = {}, fallback = {}) {
  return {
    title: clean(raw.title) || fallback.title || "Property listing",
    community: clean(raw.community).toUpperCase() || fallback.community || "",
    subcommunity: clean(raw.subcommunity) || fallback.subcommunity || "",
    building: clean(raw.building) || fallback.building || "",
    price: clean(raw.price) || fallback.price || "",
    bedrooms: asNullableNumber(raw.bedrooms ?? fallback.bedrooms),
    bathrooms: asNullableNumber(raw.bathrooms ?? fallback.bathrooms),
    sizeSqft: asNullableNumber(raw.sizeSqft ?? fallback.sizeSqft),
    propertyType: clean(raw.propertyType) || fallback.propertyType || "",
    furnishing: clean(raw.furnishing) || fallback.furnishing || "",
    parking: clean(raw.parking) || fallback.parking || "",
    serviceCharge: clean(raw.serviceCharge) || fallback.serviceCharge || "",
    floor: clean(raw.floor) || fallback.floor || "",
    view: clean(raw.view) || fallback.view || "",
    completionStatus:
      clean(raw.completionStatus) || fallback.completionStatus || "",
    developer: clean(raw.developer) || fallback.developer || "",
    yearBuilt: clean(raw.yearBuilt) || fallback.yearBuilt || "",
    ownership: clean(raw.ownership) || fallback.ownership || "",
    reraPermit: clean(raw.reraPermit) || fallback.reraPermit || "",
    paymentPlan: clean(raw.paymentPlan) || fallback.paymentPlan || "",
    nearby: asStringList(raw.nearby ?? fallback.nearby, 6),
    amenities: asStringList(raw.amenities ?? fallback.amenities, 10),
    highlights: asStringList(raw.highlights ?? fallback.highlights, 8),
    summary:
      clean(raw.summary || raw.description)
        .replace(/—/g, "-") ||
      fallback.summary ||
      "",
  };
}

async function scrapeWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing FIRECRAWL_API_KEY. Add your Firecrawl key to .env.local and restart the server."
    );
  }

  const response = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      // Keep full page content so below-the-fold sections survive.
      onlyMainContent: false,
      waitFor: 2500,
      timeout: 90_000,
      // Scroll the page so lazy-loaded description / amenities / facts hydrate.
      actions: [
        { type: "wait", milliseconds: 1500 },
        { type: "scroll", direction: "down" },
        { type: "wait", milliseconds: 1200 },
        { type: "scroll", direction: "down" },
        { type: "wait", milliseconds: 1200 },
        { type: "scroll", direction: "down" },
        { type: "wait", milliseconds: 1500 },
      ],
      formats: [
        "markdown",
        "html",
        "links",
        "images",
        {
          type: "json",
          schema: DEEP_LISTING_SCHEMA,
          prompt: `Extract Dubai property listing details useful to a buyer beyond photo, price, and location.
Focus on below-the-fold facts:
furnishing, parking, service charge, floor, view, completion/ready vs off-plan, developer, year built, ownership/freehold, RERA permit, payment plan, nearby landmarks (metro/schools/malls), concrete amenities (maid room, balcony, study, beach access, gym, pool), and specific description selling points.
Do NOT invent values. Leave unknown fields empty or null.
Do NOT waste highlights on restating the asking price or area name.`,
        },
      ],
    }),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Firecrawl returned a non-JSON response (${response.status})`);
  }

  if (!response.ok || payload?.success === false) {
    const message =
      payload?.error ||
      payload?.message ||
      `Firecrawl scrape failed (${response.status})`;
    throw new Error(message);
  }

  const data = payload?.data || payload;
  return {
    markdown: clean(data?.markdown),
    html: String(data?.html || data?.rawHtml || ""),
    links: Array.isArray(data?.links) ? data.links : [],
    images: Array.isArray(data?.images) ? data.images : [],
    metadata: data?.metadata && typeof data.metadata === "object" ? data.metadata : {},
    json: data?.json && typeof data.json === "object" ? data.json : null,
  };
}

function heuristicFallback(scraped, url) {
  const metadata = scraped.metadata || {};
  const title =
    clean(metadata.ogTitle) ||
    clean(metadata.title) ||
    clean(metadata["og:title"]) ||
    "Property listing";
  const description =
    clean(metadata.description) ||
    clean(metadata.ogDescription) ||
    clean(metadata["og:description"]) ||
    "";

  const priceMatch =
    `${title}\n${description}\n${scraped.markdown}`.match(
      /AED\s?[\d,]+(?:\.\d+)?|[\d,]{4,}\s?AED/i
    );

  return {
    title,
    community: "",
    subcommunity: "",
    price: priceMatch ? priceMatch[0].replace(/\s+/g, " ").trim() : "",
    bedrooms: null,
    bathrooms: null,
    sizeSqft: null,
    propertyType: "",
    summary:
      description ||
      "A well-presented listing ready to share with your buyer. Review the details and photos before sending.",
    highlights: [],
    amenities: [],
    ...emptyDeepFields(),
    sourceUrl: url,
  };
}

async function extractWithClaude(scraped, url, firecrawlJson) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const seed = normalizeListingFields(firecrawlJson || {}, heuristicFallback(scraped, url));

  if (!apiKey) {
    return { ...seed, sourceUrl: url };
  }

  const metadata = scraped.metadata || {};
  const markdown = scraped.markdown.slice(0, MAX_MARKDOWN_CHARS);
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1800,
    system: `You extract Dubai real-estate listing data for a buyer one-pager PDF.
Return JSON only (no markdown fences) with keys:
title, community, subcommunity, building, price, bedrooms, bathrooms, sizeSqft, propertyType,
furnishing, parking, serviceCharge, floor, view, completionStatus, developer, yearBuilt,
ownership, reraPermit, paymentPlan, nearby, amenities, highlights, summary.

The one-pager already shows photo, price, and location. Fill the rest with USEFUL facts only.

Must prioritize when present:
- furnishing (Furnished / Semi / Unfurnished)
- parking spaces
- service charge (AED / sq ft / year)
- floor number
- view (marina, sea, canal, community, park)
- ready vs off-plan / handover date
- developer / project
- year built
- freehold / ownership
- payment plan
- maid room / balcony / study / built-in wardrobes
- nearby metro / school / mall (specific names)

Rules:
- community uppercase like "DUBAI MARINA" when possible
- price like "AED 2,450,000" when known
- bedrooms/bathrooms/sizeSqft: numbers or null
- summary: 2 short sentences using useful facts only (view, furnishing, parking, service charge, layout quirks). Do NOT restate price or area name.
- highlights: 5-7 short bullets of useful facts only. FORBIDDEN in highlights: asking price, area/community name, "great location", "prime location", "ideal investment", or vague marketing fluff.
- amenities: up to 8 concrete tags (Pool, Gym, Beach access, Maid room, Balcony, Study, Covered parking). Skip fluff.
- nearby: up to 5 specific nearby places
- Never invent facts. Leave unknown strings empty and unknown numbers null.
- No em dashes anywhere`,
    messages: [
      {
        role: "user",
        content: `Source URL: ${url}
Page title: ${metadata.title || metadata.ogTitle || ""}
Description: ${metadata.description || metadata.ogDescription || ""}

Structured extract already found (may be incomplete):
${JSON.stringify(firecrawlJson || {}, null, 2)}

Full listing content after scrolling:
${markdown || "(empty markdown — use structured extract + metadata only)"}`,
      },
    ],
  });

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    const parsed = JSON.parse(raw);
    return {
      ...normalizeListingFields(parsed, seed),
      sourceUrl: url,
    };
  } catch {
    return { ...seed, sourceUrl: url };
  }
}

export function validateListingUrl(rawUrl) {
  const value = clean(rawUrl);
  if (!value) return { ok: false, error: "Please paste a listing URL." };
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "That does not look like a valid URL." };
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return { ok: false, error: "URL must start with http:// or https://." };
  }
  return { ok: true, url: parsed.toString() };
}

export async function scrapeListingForProposal(rawUrl) {
  const validated = validateListingUrl(rawUrl);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const scraped = await scrapeWithFirecrawl(validated.url);
  const extracted = await extractWithClaude(scraped, validated.url, scraped.json);

  // Prefer PF/Bayut unit media; never agent headshots or related listing HTML pages.
  const images = uniqueUrls([
    ...collectImagesFromMetadata(scraped.metadata),
    ...collectImagesFromHtml(scraped.html, validated.url),
    ...(Array.isArray(scraped.images) ? scraped.images : []),
    ...collectImagesFromMarkdown(scraped.markdown),
    ...collectImagesFromLinks(scraped.links),
  ])
    .filter((url) => looksLikePropertyImage(url))
    .sort((a, b) => scoreUnitImage(b) - scoreUnitImage(a))
    .slice(0, MAX_IMAGES);

  return {
    ...extracted,
    images,
    metadata: {
      pageTitle: scraped.metadata?.title || scraped.metadata?.ogTitle || null,
      source: scraped.metadata?.sourceURL || validated.url,
    },
  };
}

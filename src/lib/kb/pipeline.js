import { crawlWebsite, normalizeUrl } from "./crawler.js";
import { extractKnowledgeFromCrawl } from "./extractor.js";

// In-memory progress tracker fallback in case DB table is pending migration
const memoryJobs = new Map();

export function getMemoryJob(jobId) {
  return memoryJobs.get(jobId) || null;
}

export function setMemoryJob(jobId, data) {
  const prev = memoryJobs.get(jobId) || {};
  memoryJobs.set(jobId, { ...prev, ...data, updated_at: new Date().toISOString() });
}

async function safeUpdateSource(supabase, sourceId, updates) {
  setMemoryJob(sourceId, updates);
  if (!supabase || !sourceId) return;

  try {
    const { error } = await supabase
      .from("tenant_kb_sources")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sourceId);

    if (error && !/does not exist|schema cache/i.test(error.message)) {
      console.warn("safeUpdateSource warning:", error.message);
    }
  } catch (err) {
    // Non-fatal if table not migrated yet
  }
}

async function safeUpdateTenantKb(supabase, tenantId, kbText) {
  if (!supabase || !tenantId) return;

  try {
    const { error } = await supabase
      .from("tenants")
      .update({
        kb_text: kbText,
      })
      .eq("id", tenantId);

    if (error) {
      console.warn("safeUpdateTenantKb warning:", error.message);
    }
  } catch (err) {
    console.warn("safeUpdateTenantKb exception:", err.message);
  }
}

/**
 * Runs the end-to-end async crawl and extraction pipeline for a tenant.
 *
 * @param {object} params
 * @param {any} params.supabase - Supabase client with service role
 * @param {string} params.tenantId - Tenant UUID
 * @param {string} params.sourceId - Source tracking UUID
 * @param {string} params.url - URL to crawl
 * @param {boolean} [params.isSubUrl=false] - Whether this is an isolated sub-URL to merge
 * @param {string} [params.tenantName=""] - Brokerage name
 * @param {string} [params.existingKb=""] - Current knowledge text
 * @returns {Promise<{ ok: boolean, kbText?: string, error?: string }>}
 */
export async function executeCrawlPipeline({
  supabase,
  tenantId,
  sourceId,
  url,
  isSubUrl = false,
  tenantName = "",
  existingKb = "",
}) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    const errorMsg = `Invalid website URL: ${url}`;
    await safeUpdateSource(supabase, sourceId, {
      status: "failed",
      current_step: errorMsg,
      error: errorMsg,
      progress_percent: 0,
    });
    return { ok: false, error: errorMsg };
  }

  try {
    await safeUpdateSource(supabase, sourceId, {
      status: "crawling",
      current_step: "Discovering website structure...",
      progress_percent: 10,
    });

    const maxPages = isSubUrl ? 1 : 15;
    const crawlResult = await crawlWebsite(normalized, {
      maxPages,
      singleUrlOnly: isSubUrl,
      onProgress: async ({ step, pagesCrawled, pagesFound, currentUrl }) => {
        const pct = Math.min(65, 10 + Math.round((pagesCrawled / Math.max(1, pagesFound)) * 55));
        await safeUpdateSource(supabase, sourceId, {
          status: "crawling",
          current_step: `Crawled ${pagesCrawled} of ${pagesFound} pages... (${currentUrl})`,
          pages_found: pagesFound,
          pages_crawled: pagesCrawled,
          progress_percent: pct,
        });
      },
    });

    if (!crawlResult.aggregatedText || crawlResult.aggregatedText.length < 50) {
      throw new Error(
        "Could not extract sufficient text from the website. Check that the site is public and reachable."
      );
    }

    await safeUpdateSource(supabase, sourceId, {
      status: "extracting",
      current_step: "Synthesizing brokerage knowledge with Claude AI...",
      pages_found: crawlResult.pagesCrawled,
      pages_crawled: crawlResult.pagesCrawled,
      progress_percent: 75,
      raw_text: crawlResult.aggregatedText.slice(0, 100000),
    });

    const extraction = await extractKnowledgeFromCrawl({
      rawText: crawlResult.aggregatedText,
      websiteUrl: normalized,
      existingKb: isSubUrl ? existingKb : "",
      tenantName,
    });

    // Save final state
    await safeUpdateSource(supabase, sourceId, {
      status: "ready",
      current_step: `Extracted ${extraction.wordCount} words from ${crawlResult.pagesCrawled} pages.`,
      progress_percent: 100,
      extracted_kb: extraction.kbText,
      error: null,
    });

    // Persist to tenants.kb_text
    await safeUpdateTenantKb(supabase, tenantId, extraction.kbText);

    return {
      ok: true,
      kbText: extraction.kbText,
      pagesCrawled: crawlResult.pagesCrawled,
      wordCount: extraction.wordCount,
    };
  } catch (error) {
    const errorMsg = error?.message || "Crawl and extraction failed";
    console.error("Crawl pipeline error:", error);
    await safeUpdateSource(supabase, sourceId, {
      status: "failed",
      current_step: `Error: ${errorMsg}`,
      error: errorMsg,
      progress_percent: 0,
    });
    return { ok: false, error: errorMsg };
  }
}

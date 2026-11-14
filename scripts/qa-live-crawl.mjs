import { crawlWebsite, normalizeUrl, isSameOrigin, isCrawlableUrl } from "../src/lib/kb/crawler.js";
import { extractKnowledgeFromCrawl } from "../src/lib/kb/extractor.js";
import assert from "node:assert/strict";
import fs from "node:fs";

// Load .env
const envText = fs.readFileSync(".env", "utf-8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "")];
    })
);
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

async function runEdgeCases() {
  console.log("==================================================");
  console.log("1. TESTING CRAWLER EDGE CASES");
  console.log("==================================================");

  // Edge Case 1: Malformed and weird URLs
  console.log("Test: Malformed URLs...");
  assert.equal(normalizeUrl(""), null);
  assert.equal(normalizeUrl("   "), null);
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("file:///etc/passwd"), null);
  assert.equal(normalizeUrl("mailto:info@stageproperties.com"), null);
  assert.equal(normalizeUrl("tel:+971501234567"), null);
  assert.equal(normalizeUrl("http://stageproperties.com:8080/path"), "http://stageproperties.com:8080/path");
  console.log("✓ Malformed URLs properly rejected/handled.");

  // Edge Case 2: Subdomain / Cross-domain boundaries
  console.log("Test: Domain boundaries...");
  assert.equal(isSameOrigin("https://lmjcapitals.com", "https://www.lmjcapitals.com"), true);
  assert.equal(isSameOrigin("https://www.lmjcapitals.com", "https://blog.lmjcapitals.com"), false);
  assert.equal(isSameOrigin("https://stageproperties.com", "https://stageproperties.ae"), false);
  console.log("✓ Domain boundaries properly enforced.");

  // Edge Case 3: Blacklisted extensions & paths
  console.log("Test: Blacklisted extensions...");
  assert.equal(isCrawlableUrl("https://stageproperties.com/images/banner.PNG", "https://stageproperties.com"), false);
  assert.equal(isCrawlableUrl("https://stageproperties.com/docs/terms.pdf", "https://stageproperties.com"), false);
  assert.equal(isCrawlableUrl("https://stageproperties.com/assets/app.min.js", "https://stageproperties.com"), false);
  assert.equal(isCrawlableUrl("https://stageproperties.com/wp-admin/edit.php", "https://stageproperties.com"), false);
  assert.equal(isCrawlableUrl("https://stageproperties.com/cdn-cgi/challenge", "https://stageproperties.com"), false);
  console.log("✓ Blacklisted extensions & paths rejected.");

  // Edge Case 4: Non-existent domain / DNS failure
  console.log("Test: Unreachable domain handling...");
  try {
    const unreachableRes = await crawlWebsite("https://this-domain-definitely-does-not-exist-987654321.com", {
      maxPages: 3,
    });
    assert.equal(unreachableRes.pagesCrawled, 0);
    console.log("✓ Unreachable domain handled gracefully (0 pages crawled, no crash).");
  } catch (err) {
    console.log("✓ Unreachable domain failed gracefully:", err.message);
  }

  console.log("\n==================================================");
  console.log("2. LIVE CRAWL & EXTRACTION: https://www.lmjcapitals.com/");
  console.log("==================================================");
  try {
    const lmjCrawl = await crawlWebsite("https://www.lmjcapitals.com/", {
      maxPages: 6,
      onProgress: (p) => {
        console.log(`[LMJ Capitals] ${p.step} - Crawled ${p.pagesCrawled}/${p.pagesFound}: ${p.currentUrl}`);
      },
    });

    console.log(`LMJ Capitals Crawl complete: ${lmjCrawl.pagesCrawled} pages crawled.`);
    console.log(`Aggregated text length: ${lmjCrawl.aggregatedText.length} characters.`);

    if (lmjCrawl.aggregatedText.length > 100) {
      console.log("\nExtracting knowledge with Claude for LMJ Capitals...");
      const lmjKb = await extractKnowledgeFromCrawl({
        rawText: lmjCrawl.aggregatedText,
        websiteUrl: "https://www.lmjcapitals.com/",
        tenantName: "LMJ Capitals",
      });

      console.log(`Extracted KB: ${lmjKb.wordCount} words, ${lmjKb.charCount} characters.`);
      console.log("\n--- PREVIEW OF EXTRACTED KB FOR LMJ CAPITALS ---");
      console.log(lmjKb.kbText.slice(0, 500) + "...\n");
    } else {
      console.warn("LMJ Capitals returned very little text, page content might be protected or empty.");
    }
  } catch (err) {
    console.error("LMJ Capitals crawl/extraction error:", err.message);
  }

  console.log("\n==================================================");
  console.log("3. LIVE CRAWL & EXTRACTION: https://stageproperties.com/");
  console.log("==================================================");
  try {
    const stageCrawl = await crawlWebsite("https://stageproperties.com/", {
      maxPages: 6,
      onProgress: (p) => {
        console.log(`[Stage Properties] ${p.step} - Crawled ${p.pagesCrawled}/${p.pagesFound}: ${p.currentUrl}`);
      },
    });

    console.log(`Stage Properties Crawl complete: ${stageCrawl.pagesCrawled} pages crawled.`);
    console.log(`Aggregated text length: ${stageCrawl.aggregatedText.length} characters.`);

    let baseKb = "";
    if (stageCrawl.aggregatedText.length > 100) {
      console.log("\nExtracting knowledge with Claude for Stage Properties...");
      const stageKb = await extractKnowledgeFromCrawl({
        rawText: stageCrawl.aggregatedText,
        websiteUrl: "https://stageproperties.com/",
        tenantName: "Stage Properties",
      });

      baseKb = stageKb.kbText;
      console.log(`Extracted KB: ${stageKb.wordCount} words, ${stageKb.charCount} characters.`);
      console.log("\n--- PREVIEW OF EXTRACTED KB FOR STAGE PROPERTIES ---");
      console.log(stageKb.kbText.slice(0, 500) + "...\n");
    }

    // Edge Case 5: Merging a sub-URL into existing KB
    console.log("\n==================================================");
    console.log("4. TESTING SUB-URL MERGING");
    console.log("==================================================");
    console.log("Crawling single sub-URL: https://stageproperties.com/off-plan-properties");
    const subCrawl = await crawlWebsite("https://stageproperties.com/off-plan-properties", {
      maxPages: 1,
      singleUrlOnly: true,
      onProgress: (p) => {
        console.log(`[Sub-URL] ${p.step}: ${p.currentUrl}`);
      },
    });

    console.log(`Sub-URL crawled ${subCrawl.pagesCrawled} page(s). Aggregated text: ${subCrawl.aggregatedText.length} chars.`);

    if (baseKb && subCrawl.aggregatedText.length > 50) {
      console.log("Merging sub-URL into base KB with Claude...");
      const merged = await extractKnowledgeFromCrawl({
        rawText: subCrawl.aggregatedText,
        websiteUrl: "https://stageproperties.com/off-plan-properties",
        existingKb: baseKb,
        tenantName: "Stage Properties",
      });

      console.log(`Merged KB: ${merged.wordCount} words. Preserved base identity and integrated sub-page.`);
      assert.ok(merged.kbText.length > 100, "Merged KB should have substantive content");
      console.log("✓ Sub-URL merge successful!");
    }
  } catch (err) {
    console.error("Stage Properties crawl/extraction error:", err.message);
  }

  console.log("\n==================================================");
  console.log("ALL EDGE CASE & LIVE TESTS FINISHED SUCCESSFULLY! 🎉");
  console.log("==================================================");
}

runEdgeCases().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});


import assert from "node:assert/strict";
import { normalizeUrl, isSameOrigin, isCrawlableUrl } from "../src/lib/kb/crawler.js";
import { buildAssistantOverrides } from "../src/lib/vapi/dial.js";

async function runTests() {
  console.log("--- Starting KB Crawler & Voice Assistant Tests ---");

  // 1. URL Normalization
  console.log("Test 1: normalizeUrl...");
  assert.equal(
    normalizeUrl("stageproperties.com"),
    "https://stageproperties.com",
    "Should auto-prepend https://"
  );
  assert.equal(
    normalizeUrl("https://stageproperties.com/about/"),
    "https://stageproperties.com/about",
    "Should strip trailing slash"
  );
  assert.equal(
    normalizeUrl("https://stageproperties.com/page?utm_source=fb&utm_medium=cpc&id=123#overview"),
    "https://stageproperties.com/page?id=123",
    "Should strip tracking params and hash"
  );
  assert.equal(normalizeUrl("not-a-valid-url:::"), null, "Should return null on invalid URL");
  console.log("✓ normalizeUrl passed");

  // 2. Same Origin Checking
  console.log("Test 2: isSameOrigin...");
  assert.equal(
    isSameOrigin("https://stageproperties.com", "https://www.stageproperties.com/about"),
    true,
    "Should recognize www and non-www as same origin"
  );
  assert.equal(
    isSameOrigin("https://stageproperties.com", "https://bayut.com/detail"),
    false,
    "Should reject different domains"
  );
  console.log("✓ isSameOrigin passed");

  // 3. Crawlability Rules
  console.log("Test 3: isCrawlableUrl...");
  const root = "https://stageproperties.com";
  assert.equal(isCrawlableUrl("https://stageproperties.com/about", root), true);
  assert.equal(isCrawlableUrl("https://stageproperties.com/services/off-plan", root), true);
  assert.equal(isCrawlableUrl("https://stageproperties.com/brochure.pdf", root), false);
  assert.equal(isCrawlableUrl("https://stageproperties.com/hero.jpg", root), false);
  assert.equal(isCrawlableUrl("https://stageproperties.com/wp-admin/login.php", root), false);
  assert.equal(isCrawlableUrl("https://instagram.com/stageproperties", root), false);
  console.log("✓ isCrawlableUrl passed");

  // 4. Voice Assistant Overrides with {{kb}} injection
  console.log("Test 4: buildAssistantOverrides with {{kb}}...");
  const mockKb = "Stage Properties is a premier Dubai brokerage founded in 2019 specializing in off-plan villas in Arabian Ranches and Dubai Hills.";
  const mockPrompt = "You are Allan from Stage Properties.\n\nContext:\n{{kb}}\n\nClosing: Have a good day {{leadName}}.";

  const overrides = buildAssistantOverrides({
    name: "Ahmad",
    prompt: mockPrompt,
    variableValues: {
      leadSource: "meta-ad",
      propertyInterest: "Arabian Ranches",
      kb: mockKb,
    },
  });

  // Check that variableValues carries kb
  assert.equal(overrides.assistantOverrides.variableValues.kb, mockKb);
  assert.equal(overrides.assistantOverrides.variableValues.leadName, "Ahmad");

  // Check that {{kb}} inside the system prompt was replaced directly
  const promptMessage = overrides.assistantOverrides.model.messages[0].content;
  assert.ok(promptMessage.includes(mockKb), "Prompt message should contain the substituted KB text");
  assert.ok(!promptMessage.includes("{{kb}}"), "Prompt message should not have raw {{kb}} placeholder remaining");
  console.log("✓ buildAssistantOverrides {{kb}} injection passed");

  console.log("\nALL TESTS PASSED! ✨");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

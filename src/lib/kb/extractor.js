import Anthropic from "@anthropic-ai/sdk";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 3000;

const EXTRACTION_SYSTEM_PROMPT = `You are a real estate knowledge extraction specialist for AgentZero, an autonomous voice calling AI used by Dubai real estate brokerages.

Your task is to analyze raw website crawl data from a real estate brokerage or property development website, and synthesize it into a clean, authoritative Brokerage Knowledge Base block.

This knowledge block will be directly injected into the voice calling AI's system prompt ({{kb}}). During live outbound phone calls with prospects, buyers, and investors, the AI assistant relies on this knowledge block to answer questions accurately and naturally.

GUIDELINES FOR VOICE AGENT ACCURACY:
1. Grounding: Only include factual information explicitly present in the provided crawl text. Do not invent office locations, license numbers, or contact details.
2. Anti-Hallucination on Pricing: Do NOT invent specific unit prices or promise guaranteed returns. If a project or area starting price is explicitly stated (e.g. "Starting from AED 1.2M"), you may note it as "starting from" only.
3. Tone: Professional, authoritative, factual, written in third person.
4. Structure: Organize into clear, scannable sections:
   - **Brokerage Overview**: Name, background, licensing (RERA/DLD if found), headquarters/office location.
   - **Specializations & Areas**: Key Dubai communities (e.g. Downtown, Marina, Palm, Dubai Hills, Arabian Ranches), asset classes (off-plan, secondary villas, luxury penthouses, commercial, leasing).
   - **Developers & Projects**: Major developer partners (Emaar, Sobha, Damac, Nakheel, Meraas, Ellington, etc.) and notable featured projects/developments.
   - **Services Offered**: Buyer advisory, investor portfolio management, Golden Visa consultation, property handover, mortgage assistance.
   - **Client FAQs & Policies**: Booking processes, viewing arrangements, fee policies (if mentioned).
   - **Contact & Location**: Official phone numbers, WhatsApp, office address, operating hours.
5. Conciseness: Aim for 600 to 1,200 words. Keep it dense and informative.`;

/**
 * Extracts a structured knowledge base block from raw crawled text.
 *
 * @param {object} params
 * @param {string} params.rawText - Aggregated text from website crawl
 * @param {string} [params.websiteUrl] - The root or sub-page URL
 * @param {string} [params.existingKb] - Existing knowledge base to merge with (if adding a sub-URL)
 * @param {string} [params.tenantName] - Brokerage name if known
 * @returns {Promise<{ kbText: string, wordCount: number, charCount: number }>}
 */
export async function extractKnowledgeFromCrawl({
  rawText,
  websiteUrl = "",
  existingKb = "",
  tenantName = "",
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured in environment");
  }

  if (!rawText || rawText.trim().length < 50) {
    throw new Error("Crawled website contained insufficient text content to extract knowledge.");
  }

  const client = new Anthropic({ apiKey });

  let userPrompt = "";
  if (existingKb && existingKb.trim().length > 100) {
    userPrompt = `You are updating and merging new website crawl data into an existing knowledge base for ${tenantName || "this brokerage"}.

SOURCE URL: ${websiteUrl}

--- EXISTING KNOWLEDGE BASE ---
${existingKb.slice(0, 15000)}

--- NEW CRAWL DATA ---
${rawText.slice(0, 70000)}

INSTRUCTIONS:
Carefully merge the new crawl findings into the existing knowledge base.
- Retain all established brokerage background, locations, and specializations from the existing knowledge.
- Incorporate newly discovered projects, developer relationships, community coverage, or services from the new crawl.
- If there is conflicting or updated information, prioritize the newer crawl data.
- Return the complete, updated knowledge base block.`;
  } else {
    userPrompt = `Here is the raw website crawl data for ${tenantName ? `the brokerage "${tenantName}"` : "the brokerage"} from ${websiteUrl}:

--- CRAWLED WEBSITE TEXT ---
${rawText.slice(0, 75000)}

Generate the structured Brokerage Knowledge Base block adhering to the guidelines.`;
  }

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const textBlock = response.content?.[0]?.type === "text" ? response.content[0].text : "";
  const cleanedKb = textBlock.trim();

  const words = cleanedKb ? cleanedKb.split(/\s+/).filter(Boolean).length : 0;

  return {
    kbText: cleanedKb,
    wordCount: words,
    charCount: cleanedKb.length,
  };
}

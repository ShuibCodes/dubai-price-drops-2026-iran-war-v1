import Anthropic from "@anthropic-ai/sdk";
import { normalizePhone } from "@/lib/leads/normalize";

const MODEL = "claude-haiku-4-5";
const MAX_BODY_CHARS = 48_000;

const PARSE_SYSTEM = `You analyze forwarded property portal emails for a Dubai real estate CRM.

Determine whether the message is a genuine property enquiry from a buyer or tenant (someone asking about a listing, viewing, price, availability, or similar).

NOT an enquiry: newsletters, marketing blasts, invoices, receipts, account notifications, password resets, generic platform updates, spam, or messages with no identifiable person seeking a specific property.

The email layout and wording vary by portal and over time. Do not assume a fixed template.

Return ONLY a JSON object (no markdown fences, no commentary) with these keys:
- is_enquiry: boolean
- lead_name: string or null
- lead_phone: string or null (as written in the email; do not invent)
- listing_title: string or null
- listing_url: string or null
- area: string or null (location, neighborhood, or community if identifiable)
- price: string or null (as written, e.g. "1.2M AED")

If unsure whether it is an enquiry, set is_enquiry to false. Do not invent contact or listing details not supported by the email body.`;

function cleanText(value, maxLen = 500) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function stripJsonFences(text) {
  return String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function coerceBool(value) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "yes") return true;
    if (lower === "false" || lower === "no") return false;
  }
  return false;
}

function normalizeExtractedFields(raw) {
  const is_enquiry = coerceBool(raw?.is_enquiry);
  return {
    is_enquiry,
    lead_name: cleanText(raw?.lead_name, 200),
    lead_phone: cleanText(raw?.lead_phone, 80),
    listing_title: cleanText(raw?.listing_title, 500),
    listing_url: cleanText(raw?.listing_url, 2000),
    area: cleanText(raw?.area, 200),
    price: cleanText(raw?.price, 120),
  };
}

/**
 * @param {{ rawText: string, fromAddress?: string | null, client?: { messages: { create: Function } } }} args
 *   client — optional Anthropic SDK stand-in (unit tests only)
 * @returns {Promise<{
 *   status: 'parsed' | 'skipped',
 *   skip_reason: string | null,
 *   from_address: string | null,
 *   is_enquiry: boolean,
 *   lead_name: string | null,
 *   lead_phone: string | null,
 *   listing_title: string | null,
 *   listing_url: string | null,
 *   area: string | null,
 *   price: string | null,
 * }>}
 */
export async function parseEnquiryEmail({
  rawText,
  fromAddress = null,
  client: clientOverride = null,
}) {
  let client = clientOverride;
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
    client = new Anthropic({ apiKey });
  }

  const body = String(rawText || "");
  const truncated =
    body.length > MAX_BODY_CHARS
      ? `${body.slice(0, MAX_BODY_CHARS)}\n\n[truncated]`
      : body;

  const from = cleanText(fromAddress, 320);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: PARSE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `From address (envelope): ${from || "unknown"}

Email body:
${truncated || "(empty)"}`,
      },
    ],
  });

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const withoutFence = stripJsonFences(raw);

  let parsed;
  try {
    parsed = JSON.parse(withoutFence);
  } catch {
    throw new Error("Dubizzle parse: Claude returned invalid JSON");
  }

  const fields = normalizeExtractedFields(parsed);
  const from_address = from;

  if (!fields.is_enquiry) {
    return {
      status: "skipped",
      skip_reason: "not_an_enquiry",
      from_address,
      ...fields,
    };
  }

  const normalizedPhone = fields.lead_phone
    ? normalizePhone(fields.lead_phone)
    : null;

  if (!normalizedPhone) {
    return {
      status: "skipped",
      skip_reason: "no_valid_phone",
      from_address,
      ...fields,
      lead_phone: null,
    };
  }

  return {
    status: "parsed",
    skip_reason: null,
    from_address,
    ...fields,
    lead_phone: normalizedPhone,
  };
}

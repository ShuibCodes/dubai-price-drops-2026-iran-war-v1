import { z } from "zod";

/** Goal dropdown. `config_json.goal` stores the `id`. */
export const GOALS = [
  { id: "qualify", label: "Qualify interest" },
  { id: "re_engage", label: "Re-engage a quiet lead" },
  { id: "book_viewing", label: "Book a viewing" },
  { id: "remind_viewing", label: "Remind about a viewing" },
  { id: "collect_feedback", label: "Collect viewing feedback" },
];

/** Curated voices. `config_json.voice_id` stores the `id`.
 * First entry is live 1416 Allan (ElevenLabs). Vapi-native is not required. */
export const VOICE_ALLOWLIST = [
  {
    id: "Jot7IsvC9VkWPLPjLDKw",
    label: "Allan",
    provider: "11labs",
    model: "eleven_turbo_v2_5",
  },
  { id: "Elliot", label: "Elliot", provider: "vapi" },
  { id: "Savannah", label: "Savannah", provider: "vapi" },
  { id: "Hana", label: "Hana", provider: "vapi" },
  { id: "Cole", label: "Cole", provider: "vapi" },
  { id: "Harry", label: "Harry", provider: "vapi" },
  { id: "Paige", label: "Paige", provider: "vapi" },
  { id: "Spencer", label: "Spencer", provider: "vapi" },
  { id: "Neha", label: "Neha", provider: "vapi" },
];

/**
 * Rule keys stored on `config_json.rules`. Sentences are expanded in the
 * composer (Phase 3). `ai_disclosure` is locked — config cannot drop it.
 *
 * Rules are additive. SCAFFOLD (and PREAMBLE) is the non-negotiable floor.
 * Ticking a rule only ever adds instruction on top. Unticking a rule never
 * removes baseline behaviour.
 *
 * Phase 8 UI: checkbox labels must read as "also do this", not as on/off
 * toggles that strip SCAFFOLD when cleared.
 */
export const RULES = [
  {
    key: "ai_disclosure",
    locked: true,
    label:
      "Also say yes plainly if asked whether you are AI, then continue.",
    sentence:
      "If asked whether you are AI, say yes plainly and continue. Do not hide it.",
  },
  {
    key: "privacy_name",
    locked: false,
    label:
      "Also speak names as first name plus last initial only — never a full surname.",
    sentence:
      "When speaking a lead's name, use first name plus last initial only. Never say a full surname.",
  },
  {
    key: "no_quote_price",
    locked: false,
    label:
      "Also never quote a price, payment plan, or discount — offer an agent follow-up with numbers.",
    sentence:
      "Never quote a price, payment plan, or discount. Offer to have the agent follow up with numbers.",
  },
  {
    key: "confirm_callback",
    locked: false,
    label:
      "Also confirm a specific day and time before hanging up if they want a callback.",
    sentence:
      "If the lead wants a callback, always confirm a specific day and time before hanging up.",
  },
  {
    key: "voicemail_end",
    locked: false,
    label: "Also hang up immediately on voicemail — do not leave a message.",
    sentence: "If you reach voicemail or an answering machine, end the call immediately. Do not leave a message.",
  },
];

const GOAL_IDS = GOALS.map((g) => g.id);
const VOICE_IDS = VOICE_ALLOWLIST.map((v) => v.id);
const RULE_KEYS = RULES.map((r) => r.key);
const LOCKED_RULE_KEYS = RULES.filter((r) => r.locked).map((r) => r.key);

const findOutItemSchema = z
  .strictObject({
    label: z.string().trim().min(1),
    type: z.enum(["number", "choice", "text"]),
  });

export const scriptConfigSchema = z
  .strictObject({
    goal: z.enum(GOAL_IDS),
    voice_id: z.enum(VOICE_IDS),
    opening_line: z.string().max(200),
    find_out: z.array(findOutItemSchema).max(8),
    rules: z.array(z.enum(RULE_KEYS)),
    extra_context: z.string().max(300),
  })
  .check((ctx) => {
    const rules = ctx.value.rules;
    if (new Set(rules).size !== rules.length) {
      ctx.issues.push({
        code: "custom",
        message: "Duplicate rule keys",
        path: ["rules"],
        input: rules,
        continue: true,
      });
    }
    for (const key of LOCKED_RULE_KEYS) {
      if (!rules.includes(key)) {
        ctx.issues.push({
          code: "custom",
          message: "Required rules cannot be removed",
          path: ["rules"],
          input: rules,
          continue: true,
        });
      }
    }
  });

/**
 * @param {unknown} input
 * @returns {{ ok: true, data: object } | { ok: false, fieldErrors: Record<string, string> }}
 */
export function parseScriptConfig(input) {
  const result = scriptConfigSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  const fieldErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.length ? issue.path.join(".") : "_root";
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return { ok: false, fieldErrors };
}

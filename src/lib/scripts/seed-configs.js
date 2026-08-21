/**
 * Seed configs for Phase 6. Import these — do not invent new copy there.
 *
 * cold_list opening_line and find_out are the live 1416 Vapi wording, copied
 * verbatim. Do not paraphrase.
 */

const BASE_RULES = [
  "ai_disclosure",
  "privacy_name",
  "no_quote_price",
  "confirm_callback",
  "voicemail_end",
];

/** Live post-permission frame. Do not tidy. */
export const COLD_LIST_OPENING_LINE =
  "Cool. So — we've got access to some of the latest underpriced property deals in the UAE, and I've just got a few quick questions so we send you the ones that actually fit.";

/** Live qualification questions. Do not tidy. */
export const COLD_LIST_FIND_OUT = [
  {
    label:
      "So first of all, {{leadName}} — if the right deal came up at the right price, is it something you'd invest in, or somewhere you'd live yourself?",
    type: "choice",
  },
  {
    label:
      "And what sort of budget are you comfortable around, in dirhams? A rough number is completely fine.",
    type: "number",
  },
  {
    label: "Which areas have caught your eye so far?",
    type: "text",
  },
  {
    label:
      "And timing-wise — would you move on the right one now, in the next few months, or is this more of a someday thing?",
    type: "choice",
  },
];

export const COLD_LIST_CONFIG = {
  goal: "qualify",
  voice_id: "Jot7IsvC9VkWPLPjLDKw",
  opening_line: COLD_LIST_OPENING_LINE,
  find_out: COLD_LIST_FIND_OUT,
  rules: BASE_RULES,
  extra_context: "",
};

export const REENGAGE_CONFIG = {
  goal: "re_engage",
  voice_id: "Jot7IsvC9VkWPLPjLDKw",
  opening_line:
    "Cool. You looked at a few things with us and then it went quiet — I've just got a couple of questions so we only send what still fits.",
  find_out: [
    {
      label:
        "So first — are you still in the market, or has something already landed?",
      type: "choice",
    },
    {
      label:
        "And budget-wise, are we still in the same range, in dirhams, or has that moved?",
      type: "number",
    },
    {
      label: "Which areas are still on the list?",
      type: "text",
    },
    {
      label:
        "If the right one showed up this week, would you actually look at it, or is timing further out?",
      type: "choice",
    },
  ],
  rules: BASE_RULES,
  extra_context: "",
};

export const VIEWING_REMINDER_CONFIG = {
  goal: "remind_viewing",
  voice_id: "Jot7IsvC9VkWPLPjLDKw",
  opening_line:
    "Cool. This is a quick one about your viewing — I just need to confirm a couple of details so the consultant has it right.",
  find_out: [
    {
      label: "Are you still able to make the viewing as planned?",
      type: "choice",
    },
    {
      label: "Is anyone else coming with you?",
      type: "text",
    },
    {
      label:
        "Anything you want the consultant to have ready — parking, the layout, payment options?",
      type: "text",
    },
  ],
  rules: BASE_RULES,
  extra_context: "",
};

export const POST_VIEWING_FEEDBACK_CONFIG = {
  goal: "collect_feedback",
  voice_id: "Jot7IsvC9VkWPLPjLDKw",
  opening_line:
    "Cool. Thanks for going to that viewing — I've got two short questions so we know what to do next.",
  find_out: [
    {
      label: "Straight up — how did it feel in person?",
      type: "text",
    },
    {
      label:
        "Is it something you'd take further, or shall we look at other options?",
      type: "choice",
    },
    {
      label: "Anything that didn't work — size, light, the building, the price?",
      type: "text",
    },
  ],
  rules: BASE_RULES,
  extra_context: "",
};

/** Live tenant-assistant pointers. Config is COLD_LIST_CONFIG; publish is blocked. */
export const SEED_KEY_LIVE_COLD = "live_cold";
export const SEED_KEY_LIVE_META = "live_meta";
export const SEED_KEY_LIVE_JARVIS = "live_jarvis";

export const LIVE_ASSISTANT_SEEDS = [
  {
    seed_key: SEED_KEY_LIVE_COLD,
    display_name: "Live — cold",
    column: "vapi_assistant_id",
  },
  {
    seed_key: SEED_KEY_LIVE_META,
    display_name: "Live — Meta inbound",
    column: "vapi_assistant_id_meta",
  },
  {
    seed_key: SEED_KEY_LIVE_JARVIS,
    display_name: "Live — Jarvis",
    column: "vapi_assistant_id_jarvis",
  },
];

export const SEED_SCRIPTS = [
  {
    key: "cold_list",
    display_name: "Cold list",
    config: COLD_LIST_CONFIG,
  },
  {
    key: "re_engage",
    display_name: "Re-engage — gone quiet",
    config: REENGAGE_CONFIG,
  },
  {
    key: "viewing_reminder",
    display_name: "Viewing reminder",
    config: VIEWING_REMINDER_CONFIG,
  },
  {
    key: "post_viewing_feedback",
    display_name: "Post-viewing feedback",
    config: POST_VIEWING_FEEDBACK_CONFIG,
  },
];

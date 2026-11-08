/**
 * Vapi assistant names must be 1–40 characters on create and update.
 * No live Vapi request. Fetch is stubbed.
 *
 * node --experimental-loader ./scripts/alias-loader.mjs scripts/qa-vapi-assistant-name.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

process.env.VAPI_API_KEY = "qa-local-not-used";
process.env.VAPI_BASE_URL = "https://vapi.example.test";
process.env.VAPI_SERVER_URL = "https://example.test/api/vapi/webhook";

const {
  VAPI_ASSISTANT_NAME_MAX,
  buildVapiAssistantWriteBody,
  upsertVapiAssistant,
  vapiAssistantName,
} = await import("../src/lib/vapi/dial.js");

const VOICE_ID = "Elliot";
const PROMPT = "Test prompt. Do not place a call.";
const FIRST = "Hello, this is a test.";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function composed(slug, scriptName) {
  return `${slug} — ${scriptName}`;
}

const shortName = composed("acme", "Cold list");
check(
  "short convention name is unchanged",
  vapiAssistantName(shortName) === shortName && shortName.length < VAPI_ASSISTANT_NAME_MAX,
  `len=${vapiAssistantName(shortName).length}`
);

const exact = "a".repeat(VAPI_ASSISTANT_NAME_MAX);
check(
  "exactly 40 characters is unchanged",
  vapiAssistantName(exact) === exact && exact.length === 40
);

const longScript = composed("dubai-marina-realty", "Palm Jumeirah viewing follow-up for qualified buyers");
const longNamed = vapiAssistantName(longScript);
check(
  "long convention name becomes a valid Vapi name",
  longScript.length > 40 &&
    longNamed.length >= 1 &&
    longNamed.length <= 40 &&
    longNamed !== longScript,
  `in=${longScript.length} out=${longNamed.length}`
);
check(
  "long name is deterministic",
  vapiAssistantName(longScript) === longNamed
);

check(
  "empty name becomes untitled",
  vapiAssistantName("") === "untitled" && vapiAssistantName(null) === "untitled"
);
check(
  "whitespace-only name becomes untitled",
  vapiAssistantName(" \n\t ") === "untitled"
);

const shared = "x".repeat(80);
const left = vapiAssistantName(`${shared} alpha viewing script`);
const right = vapiAssistantName(`${shared} beta viewing script`);
check(
  "two long names that share a prefix stay distinct",
  left !== right && left.length <= 40 && right.length <= 40,
  `left=${left.length} right=${right.length}`
);

const shortBody = buildVapiAssistantWriteBody({
  name: shortName,
  prompt: PROMPT,
  voiceId: VOICE_ID,
  firstMessage: FIRST,
});
check(
  "write body keeps a short name and the rest of the assistant payload",
  shortBody.name === shortName &&
    shortBody.model?.provider === "groq" &&
    shortBody.voice?.voiceId === VOICE_ID &&
    shortBody.firstMessage === FIRST
);

const longBody = buildVapiAssistantWriteBody({
  name: longScript,
  prompt: PROMPT,
  voiceId: VOICE_ID,
  firstMessage: FIRST,
});
check(
  "write body caps a long name without dropping prompt or voice",
  longBody.name === longNamed &&
    longBody.name.length <= 40 &&
    longBody.model?.messages?.[0]?.content === PROMPT &&
    longBody.voice?.voiceId === VOICE_ID
);

const blankBody = buildVapiAssistantWriteBody({
  name: "   ",
  prompt: PROMPT,
  voiceId: VOICE_ID,
  firstMessage: FIRST,
});
check(
  "write body replaces a blank name",
  blankBody.name === "untitled" && blankBody.name.length <= 40
);

const seen = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  seen.push({
    url: String(url),
    method: init.method || "GET",
    name: init.body ? JSON.parse(init.body).name : undefined,
  });
  const existing = String(url).includes("/assistant/asst_existing");
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: existing ? "asst_existing" : "asst_qa_name" }),
  };
};

try {
  const created = await upsertVapiAssistant({
    vapiAssistantId: null,
    name: longScript,
    prompt: PROMPT,
    voiceId: VOICE_ID,
    firstMessage: FIRST,
  });
  const updated = await upsertVapiAssistant({
    vapiAssistantId: "asst_existing",
    name: longScript,
    prompt: PROMPT,
    voiceId: VOICE_ID,
    firstMessage: FIRST,
  });
  check("create returns the assistant id", created === "asst_qa_name");
  check("update returns the existing assistant id", updated === "asst_existing");
  const postCall = seen.find((c) => c.method === "POST");
  const patchCall = seen.find((c) => c.method === "PATCH");
  check(
    "create POSTs a name of at most 40 characters",
    postCall?.url === "https://vapi.example.test/assistant" &&
      postCall.name === longNamed &&
      postCall.name.length <= 40
  );
  check(
    "update PATCHes a name of at most 40 characters",
    patchCall?.url === "https://vapi.example.test/assistant/asst_existing" &&
      patchCall.name === longNamed &&
      patchCall.name.length <= 40
  );
} finally {
  globalThis.fetch = originalFetch;
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Vapi assistant name checks passed.");

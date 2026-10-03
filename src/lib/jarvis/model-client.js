import Anthropic from "@anthropic-ai/sdk";

// Which model answers a Jarvis round. Claude by default; Meta's Muse Spark when
// JARVIS_MODEL_PROVIDER=muse and MODEL_API_KEY are set, with Claude taking over
// for the rest of the turn if Muse errors, times out or returns nothing usable.
// Muse is reached through its Anthropic-compatible Messages API, so requests
// and responses keep the same shape as Claude's.

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 1400;

const MUSE_MODEL = "muse-spark-1.3"; // standard tier; "-contributor" trains on our data
const MUSE_BASE_URL = "https://api.meta.ai";
// Muse always reasons before answering and the reasoning counts toward
// max_tokens, so it needs more room than Claude for the same reply.
const MUSE_MAX_TOKENS = 4096;
const MUSE_EFFORT = "low";
const DEFAULT_MUSE_TIMEOUT_MS = 20_000;

export function museEnabled() {
  return (
    String(process.env.JARVIS_MODEL_PROVIDER || "").trim().toLowerCase() === "muse" &&
    Boolean(process.env.MODEL_API_KEY)
  );
}

export function createMuseClient() {
  const timeout =
    Number(process.env.JARVIS_MUSE_TIMEOUT_MS) || DEFAULT_MUSE_TIMEOUT_MS;
  return new Anthropic({
    // Explicit null: otherwise the SDK reads ANTHROPIC_API_KEY from the
    // environment and would send our Claude key to Meta as x-api-key.
    apiKey: null,
    authToken: process.env.MODEL_API_KEY,
    baseURL: MUSE_BASE_URL,
    timeout,
    // Fall back to Claude instead of retrying a slow or failing Muse.
    maxRetries: 0,
  });
}

// Muse returns thinking blocks that only Muse can read back. Claude is called
// without thinking, so they're dropped before handing the turn to Claude.
function withoutThinking(messages) {
  return messages.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.filter(
        (block) => block.type !== "thinking" && block.type !== "redacted_thinking"
      ),
    };
  });
}

function hasUsableOutput(response) {
  if (response?.stop_reason === "max_tokens") return false;
  return (response?.content || []).some(
    (block) =>
      block.type === "tool_use" ||
      (block.type === "text" && String(block.text || "").trim())
  );
}

/**
 * Returns createMessage({ system, tools, messages }) -> { response, provider }.
 * One instance per Jarvis turn: once Muse fails, the turn stays on Claude.
 * Clients can be injected for tests.
 */
export function createJarvisMessageClient({
  anthropicApiKey,
  claudeClient = new Anthropic({ apiKey: anthropicApiKey }),
  museClient = museEnabled() ? createMuseClient() : null,
} = {}) {
  let useMuse = Boolean(museClient);

  return async function createMessage({ system, tools, messages }) {
    if (useMuse) {
      try {
        const response = await museClient.messages.create({
          model: MUSE_MODEL,
          max_tokens: MUSE_MAX_TOKENS,
          output_config: { effort: MUSE_EFFORT },
          system,
          tools,
          messages,
        });
        if (hasUsableOutput(response)) {
          console.log(
            `[jarvis] muse round: in=${response.usage?.input_tokens} out=${response.usage?.output_tokens}`
          );
          return { response, provider: "muse" };
        }
        console.error(
          `[jarvis] muse returned no usable output (stop=${response?.stop_reason}); falling back to claude`
        );
      } catch (error) {
        console.error("[jarvis] muse failed; falling back to claude:", error.message);
      }
      useMuse = false;
    }

    const response = await claudeClient.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system,
      tools,
      messages: withoutThinking(messages),
    });
    return { response, provider: "claude" };
  };
}

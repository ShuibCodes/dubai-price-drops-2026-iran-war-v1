/**
 * Jarvis model selection: Claude by default, Muse when switched on, Claude
 * fallback when Muse fails. Fake clients only — no live HTTP.
 *
 * node scripts/qa-jarvis-model-client.mjs
 */
import { register } from "node:module";
import { readFile } from "node:fs/promises";

register("./alias-loader.mjs", import.meta.url);

const { createJarvisMessageClient, createMuseClient, museEnabled } = await import(
  "../src/lib/jarvis/model-client.js"
);

let failures = 0;
function check(name, ok) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}

function fakeClient(respond) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return respond(params, calls.length);
      },
    },
  };
}

const textReply = (text) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const toolReply = { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "get_inbox_activity", input: {} }] };
const request = { system: "sys", tools: [], messages: [{ role: "user", content: "hi" }] };

// Switch
delete process.env.JARVIS_MODEL_PROVIDER;
process.env.MODEL_API_KEY = "test-muse-key";
check("Muse is off unless JARVIS_MODEL_PROVIDER=muse", museEnabled() === false);
process.env.JARVIS_MODEL_PROVIDER = "muse";
check("Muse is on with JARVIS_MODEL_PROVIDER=muse and MODEL_API_KEY", museEnabled() === true);
delete process.env.MODEL_API_KEY;
check("Muse stays off without MODEL_API_KEY", museEnabled() === false);

// Claude only
{
  const claude = fakeClient(() => textReply("from claude"));
  const createMessage = createJarvisMessageClient({ claudeClient: claude, museClient: null });
  const { response, provider } = await createMessage(request);
  check("no Muse client -> Claude answers", provider === "claude" && response.content[0].text === "from claude");
  check("Claude request uses claude-sonnet-4-6", claude.calls[0].model === "claude-sonnet-4-6");
}

// Muse succeeds
{
  const claude = fakeClient(() => textReply("from claude"));
  const muse = fakeClient(() => toolReply);
  const createMessage = createJarvisMessageClient({ claudeClient: claude, museClient: muse });
  const { provider } = await createMessage(request);
  const sent = muse.calls[0];
  check("Muse on -> Muse answers", provider === "muse" && claude.calls.length === 0);
  check("Muse request uses the standard-tier model", sent.model === "muse-spark-1.3");
  check("Muse request uses low effort", sent.output_config?.effort === "low");
  check("Muse request leaves room for reasoning", sent.max_tokens >= 2048);
}

// Muse throws -> Claude, and the turn stays on Claude
{
  const claude = fakeClient(() => textReply("from claude"));
  const muse = fakeClient(() => {
    throw new Error("internal server error");
  });
  const createMessage = createJarvisMessageClient({ claudeClient: claude, museClient: muse });
  const first = await createMessage(request);
  const second = await createMessage(request);
  check("Muse error -> Claude answers", first.provider === "claude");
  check("after a Muse error the rest of the turn stays on Claude", second.provider === "claude" && muse.calls.length === 1);
}

// Muse uses the whole budget reasoning -> Claude
{
  const claude = fakeClient(() => textReply("from claude"));
  const muse = fakeClient(() => ({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "..." }] }));
  const createMessage = createJarvisMessageClient({ claudeClient: claude, museClient: muse });
  const { provider } = await createMessage(request);
  check("Muse empty reply (max_tokens) -> Claude answers", provider === "claude");
}

// Muse whitespace-only text -> Claude
{
  const claude = fakeClient(() => textReply("from claude"));
  const muse = fakeClient(() => textReply("   "));
  const createMessage = createJarvisMessageClient({ claudeClient: claude, museClient: muse });
  const { provider } = await createMessage(request);
  check("Muse blank text -> Claude answers", provider === "claude");
}

// Thinking blocks never reach Claude
{
  const claude = fakeClient(() => textReply("from claude"));
  const muse = fakeClient((params, n) => {
    if (n === 1) {
      return {
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "plan", signature: "sig" },
          { type: "tool_use", id: "t1", name: "get_inbox_activity", input: {} },
        ],
      };
    }
    throw new Error("timeout");
  });
  const createMessage = createJarvisMessageClient({ claudeClient: claude, museClient: muse });
  const first = await createMessage(request);
  const conversation = [
    ...request.messages,
    { role: "assistant", content: first.response.content },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] },
  ];
  await createMessage({ ...request, messages: conversation });
  const sentToClaude = claude.calls[0].messages[1].content;
  check("Muse thinking blocks are dropped before Claude takes over", sentToClaude.every((b) => b.type !== "thinking"));
  check("tool_use blocks are kept for Claude", sentToClaude.some((b) => b.type === "tool_use"));
  check("the original conversation is not modified", conversation[1].content.some((b) => b.type === "thinking"));
}

// The real Muse client never carries the Claude key
{
  process.env.ANTHROPIC_API_KEY = "test-claude-key";
  process.env.MODEL_API_KEY = "test-muse-key";
  const client = createMuseClient();
  check("Muse client sends the Muse key as a bearer token", client.authToken === "test-muse-key");
  check("Muse client does not pick up ANTHROPIC_API_KEY", client.apiKey === null);
  check("Muse client points at api.meta.ai", String(client.baseURL).startsWith("https://api.meta.ai"));
  check("Muse client does not retry (Claude is the fallback)", client.maxRetries === 0);
}

// Engine wiring
{
  const engine = await readFile(new URL("../src/lib/jarvis/engine.js", import.meta.url), "utf8");
  check("Jarvis engine goes through createJarvisMessageClient", /createJarvisMessageClient\(/.test(engine));
  check("Jarvis engine no longer builds its own Anthropic client", !/new Anthropic\(/.test(engine));
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;

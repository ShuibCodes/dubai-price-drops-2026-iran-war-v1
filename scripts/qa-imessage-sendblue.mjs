/**
 * QA Test Suite for Sendblue iMessage Gateway & Webhook
 *
 * node scripts/qa-imessage-sendblue.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const {
  sendblueConfigured,
  plainJarvisIMessageText,
  truncateIMessageBody,
} = await import("../src/lib/imessage/send.js");

const { GET, POST } = await import(
  "../src/app/api/imessage/webhook/route.js"
);

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nSENDBLUE CONFIGURATION & TEXT FORMATTING");
{
  check("sendblueConfigured returns boolean", typeof sendblueConfigured() === "boolean");

  const formatted = plainJarvisIMessageText("# Heading\nHere is **bold** text and **another**.");
  check("plainJarvisIMessageText strips markdown headings", !formatted.includes("# Heading"));
  check("plainJarvisIMessageText unwraps bold asterisks", formatted.includes("bold text") && !formatted.includes("**bold**"));

  const shortText = "Hello world";
  check("truncateIMessageBody keeps short text intact", truncateIMessageBody(shortText) === shortText);

  const longText = "Sentence one. ".repeat(200);
  const truncated = truncateIMessageBody(longText);
  check("truncateIMessageBody bounds text to 1500 chars", truncated.length <= 1500);
  check("truncateIMessageBody appends truncation tail", truncated.includes("(truncated — ask for more)"));
}

console.log("\nIMESSAGE WEBHOOK GET ENDPOINT");
{
  const res = await GET();
  check("GET returns HTTP Response object", res instanceof Response);
  const body = await res.json();
  check("GET status is 200 / ok: true", body?.ok === true);
  check("GET reports service name", body?.service?.includes("Sendblue"));
  check("GET reports sendblueConfigured status", typeof body?.sendblueConfigured === "boolean");
}

console.log("\nIMESSAGE WEBHOOK POST PAYLOAD INGESTION");
{
  // 1. Ignored outbound echo
  const outboundReq = new Request("http://localhost/api/imessage/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      is_outbound: true,
      content: "Echo of bot reply",
    }),
  });
  const outboundRes = await POST(outboundReq);
  const outboundBody = await outboundRes.json();
  check("outbound message is ignored cleanly", outboundBody?.status === "ignored_outbound");

  // 2. Missing sender / empty body
  const emptyReq = new Request("http://localhost/api/imessage/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      is_outbound: false,
      from_number: "",
      content: "No sender",
    }),
  });
  const emptyRes = await POST(emptyReq);
  const emptyBody = await emptyRes.json();
  check("missing sender is handled without crash", emptyBody?.status === "missing_sender");

  const emptyBodyReq = new Request("http://localhost/api/imessage/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      is_outbound: false,
      from_number: "+15551234567",
      content: "",
    }),
  });
  const emptyBodyRes = await POST(emptyBodyReq);
  const emptyBodyData = await emptyBodyRes.json();
  check("empty body message is handled cleanly", emptyBodyData?.status === "empty_body");
}

console.log("\nSUMMARY");
if (failures === 0) {
  console.log("All Sendblue iMessage QA tests passed!\n");
} else {
  console.error(`${failures} check(s) failed.\n`);
  process.exit(1);
}

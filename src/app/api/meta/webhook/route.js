import { waitUntil } from "@vercel/functions";
import { verifyMetaSignature, shouldSkipMetaSignatureCheck } from "@/lib/meta/signature";
import { processMetaWebhookPayload } from "@/lib/meta/webhook-handler";
import { runTenantAgentCopilot } from "@/lib/meta/tenant-agent-copilot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    token === process.env.META_VERIFY_TOKEN &&
    challenge
  ) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.META_APP_SECRET;

  if (!shouldSkipMetaSignatureCheck()) {
    if (!verifyMetaSignature(rawBody, signature, appSecret)) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const copilotJobs = await processMetaWebhookPayload(payload);
    for (const job of copilotJobs) {
      waitUntil(
        runTenantAgentCopilot(job).catch((error) => {
          console.error("Meta copilot error:", error.message);
        })
      );
    }
  } catch (error) {
    console.error("Meta webhook processing error:", error.message);
  }

  return new Response("OK", { status: 200 });
}

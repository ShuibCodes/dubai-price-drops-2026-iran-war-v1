import { CONNECT_AZ_REPLY, senderOwnsTenant } from "@/lib/jarvis/private-line";
import { runJarvisTurn } from "@/lib/jarvis/engine";
import { sendAgentCloudMessage } from "@/lib/whatsapp/cloud";
import { probeCoexistence } from "@/lib/meta/coexistence-status";

export async function runTenantAgentCopilot({ tenant, sender, userText }) {
  if (!senderOwnsTenant(sender, tenant?.id)) {
    console.warn("[meta-copilot] refused: sender is not an agent on this tenant");
    return { sent: false, reason: "tenant_mismatch" };
  }

  const text = String(userText || "").trim();
  if (!text) return { sent: false, reason: "empty" };

  const probe = await probeCoexistence(tenant);
  let reply;
  if (!probe.connected || !probe.live) {
    reply = CONNECT_AZ_REPLY;
  } else {
    const result = await runJarvisTurn({
      tenantId: sender.tenantId,
      messages: [{ role: "user", content: text }],
      agentName: sender.agentName,
      senderPhone: sender.waId,
    });
    reply = result.text;
  }

  const sent = await sendAgentCloudMessage({
    tenant,
    toWaId: sender.waId,
    body: reply,
  });
  if (!sent.sent) {
    console.error("[meta-copilot] Cloud API reply failed:", sent.reason);
  }
  return sent;
}

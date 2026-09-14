import { resolveJarvisSender } from "@/lib/jarvis/resolve-sender";

export function jarvisSenderMatchesScope(
  sender,
  { tenantId = null, agentId = null } = {}
) {
  if (!sender) return false;
  if (tenantId && sender.tenantId !== tenantId) return false;
  if (agentId && sender.agentId !== agentId) return false;
  return true;
}

/** True when this WhatsApp number is an AgentZero agent (own tenant locker). */
export async function isJarvisSenderAllowed(
  senderPhone,
  { tenantId = null, agentId = null } = {}
) {
  const sender = await resolveJarvisSender(senderPhone);
  return jarvisSenderMatchesScope(sender, { tenantId, agentId });
}

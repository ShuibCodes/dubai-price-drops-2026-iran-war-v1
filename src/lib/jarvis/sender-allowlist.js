import { resolveJarvisSender } from "@/lib/jarvis/resolve-sender";

/** True when this WhatsApp number is an AgentZero agent (own tenant locker). */
export async function isJarvisSenderAllowed(senderPhone) {
  const sender = await resolveJarvisSender(senderPhone);
  return Boolean(sender);
}

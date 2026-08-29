/** Empty on purpose: a stranger texting AZ should get nothing, not a lecture. */
export const PRIVATE_AZ_REPLY = "";

export const CONNECT_AZ_REPLY =
  "Your WhatsApp is not connected yet. Open your AgentZero join link, tap Connect WhatsApp, then text me again from this phone.";

export function senderOwnsTenant(sender, tenantId) {
  return Boolean(
    sender?.tenantId &&
      tenantId &&
      String(sender.tenantId) === String(tenantId)
  );
}

import { senderOwnsTenant } from "./private-line.js";

/** Twilio / shared AZ number: registered agent → their tenant only. Anyone else: silence. */
export function twilioAzDecision(sender) {
  if (sender?.tenantId) {
    return { action: "jarvis", tenantId: sender.tenantId, tenantSlug: sender.tenantSlug || null };
  }
  return { action: "silent" };
}

/**
 * Inbound on a tenant WABA.
 * Owner of THIS tenant → copilot (unless it is a reply in a lead thread).
 * Anyone else, including an agent from another tenant → ingest as a lead. Never Jarvis.
 */
export function metaInboundDecision({ sender, tenantId, message }) {
  if (!senderOwnsTenant(sender, tenantId)) {
    return { action: "ingest" };
  }
  if (message?.context?.id) {
    return { action: "ingest" };
  }
  return { action: "copilot", tenantId: sender.tenantId };
}

/**
 * Local stand-in for the unknown-sender KB confirmation test.
 * Replaces the call and email senders so a "yes" can complete
 * without a network call, a real dial, or a real email.
 */
const SELF = import.meta.url;

export async function resolve(specifier, context, nextResolve) {
  const bare = String(specifier || "").split("?")[0];
  const isVapiEntry =
    bare === "@/lib/vapi" ||
    bare.endsWith("/src/lib/vapi") ||
    bare.endsWith("/src/lib/vapi.js");
  const isEmailEntry =
    bare === "@/lib/email/resend-client" ||
    bare.endsWith("/email/resend-client.js");
  if (isVapiEntry || isEmailEntry) {
    return { url: SELF, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function fireVapiCall(args) {
  const calls = (globalThis.__kbConfirmCalls ||= []);
  calls.push({ ...args });
  return { id: "local-no-network" };
}

export async function getLatestCallByPhone() {
  return null;
}

export async function sendLeadEmail(args) {
  const emails = (globalThis.__kbConfirmEmails ||= []);
  emails.push({ ...args });
  return { id: "local-no-email" };
}

export function kbConfirmCalls() {
  return globalThis.__kbConfirmCalls || [];
}

export function kbConfirmEmails() {
  return globalThis.__kbConfirmEmails || [];
}

export function resetKbConfirmSinks() {
  globalThis.__kbConfirmCalls = [];
  globalThis.__kbConfirmEmails = [];
}

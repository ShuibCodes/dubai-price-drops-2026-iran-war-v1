/**
 * Local stand-in so self-chat tests never open a Supabase client.
 */
const SELF = import.meta.url;

export async function resolve(specifier, context, nextResolve) {
  const bare = String(specifier || "").split("?")[0];
  if (
    bare === "@/lib/supabase/server" ||
    bare.endsWith("/src/lib/supabase/server.js") ||
    bare.endsWith("/lib/supabase/server")
  ) {
    return { url: SELF, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export const MESSAGES_TABLE = "whatsapp-messages";

export function normalizeWaId(value) {
  return String(value || "").replace(/\D/g, "");
}

export function getSupabaseServerClient() {
  return globalThis.__selfChatDb || null;
}

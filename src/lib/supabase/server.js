import { createClient } from "@supabase/supabase-js";

// WhatsApp message rows live here (table renamed from "messages"; RLS enabled —
// the service-role client below bypasses it by design).
export const MESSAGES_TABLE = "whatsapp-messages";

let cachedClient = null;

export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cachedClient;
}

export function normalizeWaId(value) {
  return String(value || "").replace(/\D/g, "");
}

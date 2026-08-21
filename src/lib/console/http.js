export { jsonError, scriptsContext as consoleContext } from "@/lib/scripts/http";
export {
  AED_PER_CALL,
  CONSOLE_RUN_SOURCE,
  estCostAed,
  whatsappHealthy,
  waDeepLink,
} from "./format";

const TENANT_COLS =
  "id, slug, name, waba_id, phone_number_id, business_token, display_phone";
const TENANT_COLS_NO_DISPLAY =
  "id, slug, name, waba_id, phone_number_id, business_token";

function missingDisplayPhone(error) {
  return /display_phone/i.test(String(error?.message || ""));
}

export async function loadConsoleTenant(supabase, tenantId) {
  const first = await supabase
    .from("tenants")
    .select(TENANT_COLS)
    .eq("id", tenantId)
    .maybeSingle();
  if (!first.error) return first.data;
  if (!missingDisplayPhone(first.error)) {
    throw new Error(`Tenant lookup failed: ${first.error.message}`);
  }
  const retry = await supabase
    .from("tenants")
    .select(TENANT_COLS_NO_DISPLAY)
    .eq("id", tenantId)
    .maybeSingle();
  if (retry.error) throw new Error(`Tenant lookup failed: ${retry.error.message}`);
  return retry.data;
}

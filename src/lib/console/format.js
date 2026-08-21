export const AED_PER_CALL = Number(
  typeof process !== "undefined" && process.env.CONSOLE_AED_PER_CALL
    ? process.env.CONSOLE_AED_PER_CALL
    : 2.5
);
export const CONSOLE_RUN_SOURCE = "console-run";

export function estCostAed(count) {
  const n = Math.max(0, Number(count) || 0);
  return Math.round(n * AED_PER_CALL * 100) / 100;
}

export function whatsappHealthy(tenant) {
  return Boolean(
    tenant?.waba_id && tenant?.phone_number_id && tenant?.business_token
  );
}

export function waDeepLink(waIdOrE164) {
  const digits = String(waIdOrE164 || "").replace(/\D/g, "");
  if (!digits) return "https://wa.me/";
  return `https://wa.me/${digits}`;
}

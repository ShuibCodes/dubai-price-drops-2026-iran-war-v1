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

/** First slot is always stored, even on "start now". Only treat as scheduled if it is truly later. */
const SCHEDULE_GRACE_MS = 2 * 60 * 1000;

export function runWindowStart(run) {
  if (!run?.window_start) return null;
  const at = new Date(run.window_start);
  if (Number.isNaN(at.getTime())) return null;
  return at;
}

export function runIsScheduled(run) {
  const at = runWindowStart(run);
  return Boolean(at && at.getTime() > Date.now() + SCHEDULE_GRACE_MS);
}

export function runIsInFlight(run) {
  const status = String(run?.status || "");
  return status === "queued" || status === "running";
}

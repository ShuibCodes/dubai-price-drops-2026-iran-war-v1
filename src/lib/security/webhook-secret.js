import { timingSafeEqual } from "@/lib/security/timing-safe";

/**
 * Shared webhook shared-secret check.
 * Production: missing secret is a reject (fail closed).
 * Development: missing secret is allowed so local mapping still works.
 */
export function verifyConfiguredWebhookSecret({
  expected,
  provided,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const secret = expected == null ? "" : String(expected);
  if (!secret) {
    return nodeEnv !== "production";
  }
  return timingSafeEqual(provided, secret);
}

const PROVIDERS = new Set(["google", "facebook"]);

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

export function isSocialProviderConfigured(provider) {
  if (!PROVIDERS.has(provider)) return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return false;

  // Google predates provider flags, and its live configuration is already
  // established. Preserve that behavior while allowing an explicit kill
  // switch. Facebook is new and stays opt-in until its dashboards are ready.
  if (provider === "google") {
    return !["0", "false", "off"].includes(
      String(process.env.SUPABASE_AUTH_GOOGLE_ENABLED || "").trim().toLowerCase()
    );
  }
  return enabled(process.env.SUPABASE_AUTH_FACEBOOK_ENABLED);
}

function cleanName(value) {
  const name = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return name ? name.slice(0, 120) : null;
}

/**
 * The email must belong to the provider identity that completed this session.
 * Supabase marks trusted OAuth-provider emails confirmed; matching the identity
 * prevents a confirmation on some other linked identity from being reused.
 */
export function verifiedSocialIdentity(user, expectedProvider) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email || !user?.email_confirmed_at) return null;

  const declared = String(user?.app_metadata?.provider || "").toLowerCase();
  const expected = String(expectedProvider || "").toLowerCase();
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const candidates = identities.filter((item) => {
    const provider = String(item?.provider || "").toLowerCase();
    if (!PROVIDERS.has(provider)) return false;
    const identityEmail = String(item?.identity_data?.email || "").trim().toLowerCase();
    // Facebook often confirms user.email without copying it onto identity_data.
    // Accept a blank identity email only for this same Auth user; a different
    // address on the identity is still a mismatch.
    return !identityEmail || identityEmail === email;
  });
  const selectedProvider = PROVIDERS.has(expected) ? expected : declared;
  const identity = PROVIDERS.has(selectedProvider)
    ? candidates.find(
        (item) => String(item?.provider || "").toLowerCase() === selectedProvider
      )
    : candidates.length === 1
      ? candidates[0]
      : null;
  const provider = String(identity?.provider || "").toLowerCase();
  if (!identity || !PROVIDERS.has(provider)) {
    return null;
  }

  const displayName = cleanName(
    identity.identity_data?.full_name ||
      identity.identity_data?.name ||
      user.user_metadata?.full_name ||
      user.user_metadata?.name
  );
  return { provider, email, displayName };
}

export async function resolveOrProvisionSocialAgent(admin, identity) {
  const { data, error } = await admin.rpc("resolve_or_provision_social_agent", {
    p_auth_user_id: identity.authUserId,
    p_email: identity.email,
    p_display_name: identity.displayName,
  });
  if (error) throw new Error(`Social identity resolution failed: ${error.message}`);

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length !== 1) {
    throw new Error("Social identity resolution returned an invalid result");
  }
  const agent = rows[0];
  if (
    !agent.id ||
    !agent.tenant_id ||
    !agent.tenant_slug ||
    agent.auth_user_id !== identity.authUserId
  ) {
    throw new Error("Social identity resolution returned an incomplete identity");
  }
  return agent;
}

export function socialAuthErrorCode(error, provider = "social") {
  const message = String(error?.message || "");
  if (message.includes("AZ_IDENTITY_CONFLICT")) return "identity_conflict";
  if (message.includes("AZ_INVALID_IDENTITY")) return "social_unverified";
  if (provider === "facebook") return "facebook_failed";
  if (provider === "google") return "google_failed";
  return "social_failed";
}

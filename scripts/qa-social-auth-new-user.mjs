// Fast, read-only contract QA for social identity parsing, RPC integration,
// atomic provisioning SQL, and redirect confinement.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isSocialProviderConfigured,
  resolveOrProvisionSocialAgent,
  socialAuthErrorCode,
  verifiedSocialIdentity,
} from "../src/lib/copilot/social-auth.js";
import { safeNextPath } from "../src/lib/copilot/next-path.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(name, ok) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}

function socialUser(provider, overrides = {}) {
  const email = overrides.email ?? `${provider}@example.test`;
  return {
    id: `${provider}-auth-id`,
    email,
    email_confirmed_at: Object.hasOwn(overrides, "email_confirmed_at")
      ? overrides.email_confirmed_at
      : "2026-09-12T00:00:00Z",
    app_metadata: { provider },
    user_metadata: { full_name: `${provider} User` },
    identities:
      overrides.identities ??
      [{ provider, identity_data: { email, full_name: `${provider} User` } }],
  };
}

console.log("\nPROVIDER IDENTITY");
for (const provider of ["google", "facebook"]) {
  const identity = verifiedSocialIdentity(socialUser(provider));
  check(`${provider} confirmed matching identity accepted`, identity?.provider === provider);
  check(`${provider} email normalized`, identity?.email === `${provider}@example.test`);
}
check(
  "missing email rejected",
  verifiedSocialIdentity(socialUser("google", { email: "" })) === null
);
check(
  "unconfirmed email rejected",
  verifiedSocialIdentity(
    socialUser("facebook", { email_confirmed_at: null })
  ) === null
);
check(
  "email belonging to another identity rejected",
  verifiedSocialIdentity(
    socialUser("google", {
      identities: [
        { provider: "google", identity_data: { email: "other@example.test" } },
      ],
    })
  ) === null
);
check(
  "Facebook identity without identity_data.email still uses confirmed user.email",
  verifiedSocialIdentity(
    socialUser("facebook", {
      identities: [{ provider: "facebook", identity_data: { name: "FB User" } }],
    })
  )?.email === "facebook@example.test"
);
check(
  "Facebook identity with a different identity email is rejected",
  verifiedSocialIdentity(
    socialUser("facebook", {
      identities: [
        { provider: "facebook", identity_data: { email: "other@example.test" } },
      ],
    })
  ) === null
);
check(
  "expected Facebook identity wins for a multi-provider Auth user",
  verifiedSocialIdentity(
    {
      ...socialUser("google"),
      identities: [
        {
          provider: "google",
          identity_data: { email: "google@example.test" },
        },
        {
          provider: "facebook",
          identity_data: { email: "google@example.test" },
        },
      ],
    },
    "facebook"
  )?.provider === "facebook"
);
check("unsupported provider rejected", verifiedSocialIdentity(socialUser("github")) === null);

console.log("\nPROVIDER CONFIGURATION");
const previous = {
  url: process.env.SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY,
  google: process.env.SUPABASE_AUTH_GOOGLE_ENABLED,
  facebook: process.env.SUPABASE_AUTH_FACEBOOK_ENABLED,
};
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-only";
delete process.env.SUPABASE_AUTH_GOOGLE_ENABLED;
delete process.env.SUPABASE_AUTH_FACEBOOK_ENABLED;
check("Google preserves configured legacy default", isSocialProviderConfigured("google"));
check("Facebook is opt-in", !isSocialProviderConfigured("facebook"));
process.env.SUPABASE_AUTH_FACEBOOK_ENABLED = "1";
check("Facebook explicit enable works", isSocialProviderConfigured("facebook"));
process.env.SUPABASE_AUTH_GOOGLE_ENABLED = "0";
check("Google explicit disable works", !isSocialProviderConfigured("google"));
for (const [key, value] of Object.entries({
  SUPABASE_URL: previous.url,
  SUPABASE_ANON_KEY: previous.anon,
  SUPABASE_AUTH_GOOGLE_ENABLED: previous.google,
  SUPABASE_AUTH_FACEBOOK_ENABLED: previous.facebook,
})) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log("\nRPC CONTRACT");
const identity = {
  authUserId: "auth-id",
  email: "owner@example.test",
  displayName: "Owner",
};
let called;
const created = await resolveOrProvisionSocialAgent(
  {
    async rpc(name, args) {
      called = { name, args };
      return {
        data: [{
          id: "agent-id",
          tenant_id: "tenant-id",
          role: "admin",
          email: identity.email,
          auth_user_id: identity.authUserId,
          tenant_slug: "workspace-random",
          was_created: true,
        }],
        error: null,
      };
    },
  },
  identity
);
check("calls atomic resolver RPC", called?.name === "resolve_or_provision_social_agent");
check("passes immutable Auth user id", called?.args?.p_auth_user_id === identity.authUserId);
check("passes verified email", called?.args?.p_email === identity.email);
check("accepts one complete created identity", created.was_created === true);
let rejectedIncomplete = false;
try {
  await resolveOrProvisionSocialAgent(
    { rpc: async () => ({ data: [{ id: "agent-id" }], error: null }) },
    identity
  );
} catch {
  rejectedIncomplete = true;
}
check("incomplete RPC identity fails closed", rejectedIncomplete);
for (const provider of ["google", "facebook"]) {
  for (const wasCreated of [false, true]) {
    const providerIdentity = verifiedSocialIdentity(socialUser(provider));
    const result = await resolveOrProvisionSocialAgent(
      {
        rpc: async () => ({
          data: [{
            id: `${provider}-agent`,
            tenant_id: `${provider}-tenant`,
            role: wasCreated ? "admin" : "agent",
            email: providerIdentity.email,
            auth_user_id: `${provider}-auth-id`,
            tenant_slug: `${provider}-workspace`,
            was_created: wasCreated,
          }],
          error: null,
        }),
      },
      { ...providerIdentity, authUserId: `${provider}-auth-id` }
    );
    check(
      `${provider} ${wasCreated ? "new" : "existing"} identity uses shared resolver`,
      result.was_created === wasCreated &&
        result.auth_user_id === `${provider}-auth-id`
    );
    if (wasCreated) {
      check(`${provider} new owner is admin`, result.role === "admin");
      check(`${provider} new owner keeps verified email`, result.email === providerIdentity.email);
    }
  }
}
check(
  "identity conflict maps to a fail-closed error",
  socialAuthErrorCode(
    new Error("Social identity resolution failed: AZ_IDENTITY_CONFLICT"),
    "google"
  ) === "identity_conflict"
);
check(
  "unknown callback failure stays provider-neutral",
  socialAuthErrorCode(new Error("network failure"), "social") === "social_failed"
);

console.log("\nATOMIC SQL CONTRACT");
const migration = readFileSync(
  join(ROOT, "supabase/migrations/026_social_auth_provisioning.sql"),
  "utf8"
);
for (const [name, fragment] of [
  ["uses transaction-scoped concurrency locks", "pg_advisory_xact_lock"],
  ["resolves immutable Auth id", "where a.auth_user_id = p_auth_user_id"],
  ["resolves normalized exact email", "where lower(a.email) = normalized_email"],
  ["detects identity conflict", "AZ_IDENTITY_CONFLICT"],
  ["creates tenant inside RPC", "insert into tenants"],
  ["creates agent inside same RPC", "insert into agents"],
  ["new owner is admin", "'admin'"],
  ["new onboarding remains incomplete", "onboarded_at"],
  ["RPC denied to browser roles", "from public, anon, authenticated"],
  ["RPC granted only to service role", "to service_role"],
  ["slug allocation is bounded", "slug_attempts > 8"],
]) {
  check(name, migration.includes(fragment));
}

console.log("\nREDIRECT CONFINEMENT");
check(
  "existing user can retain own next path",
  safeNextPath("/copilot/tenant-a/runs", "tenant-a") ===
    "/copilot/tenant-a/runs"
);
check(
  "another tenant in next is rejected",
  safeNextPath("/copilot/tenant-b/runs", "tenant-a") === "/copilot/tenant-a"
);
check(
  "external next is rejected",
  safeNextPath("https://evil.example/copilot/tenant-a", "tenant-a") ===
    "/copilot/tenant-a"
);

const callback = readFileSync(
  join(ROOT, "src/app/api/copilot/auth/callback/route.js"),
  "utf8"
);
check("new account always routes to JoinWizard", callback.includes("agent.was_created"));
check("new account target ends in /join", callback.includes("/join`"));
check("existing account still uses safeNextPath", callback.includes("safeNextPath("));
check(
  "identity is verified before provisioning",
  callback.indexOf("verifiedSocialIdentity(user)") <
    callback.indexOf("resolveOrProvisionSocialAgent(admin")
);
const oauthRoute = readFileSync(
  join(ROOT, "src/lib/copilot/oauth-route.js"),
  "utf8"
);
check("Facebook explicitly requests email permission", oauthRoute.includes('scopes = "email"'));

console.log(failures ? `\n${failures} check(s) failed.\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);

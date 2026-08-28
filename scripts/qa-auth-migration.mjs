// Exercises the auth paths reachable without the Google provider enabled:
// legacy login still works, the test agent cannot use it, tenant enforcement
// survives, and the Google routes degrade instead of throwing.
// Reads credentials from .env.local and never prints them.
//
//   node scripts/qa-auth-migration.mjs
//
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = process.env.QA_ORIGIN || "http://localhost:3000";

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 1 || line.trim().startsWith("#")) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, eq).trim()] = value;
  }
  return env;
}

const hit = (path, init) =>
  fetch(`${ORIGIN}${path}`, { redirect: "manual", ...(init || {}) });

const postJson = (path, body) =>
  hit(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(44)} ${detail || ""}`);
}

const env = loadEnv();
const users = env.COPILOT_USERS_JSON ? JSON.parse(env.COPILOT_USERS_JSON) : [];
const creds = users.length
  ? { username: users[0].username, password: users[0].password }
  : { username: env.COPILOT_USERNAME, password: env.COPILOT_PASSWORD };

console.log(`\nUNAUTHENTICATED  (${ORIGIN})`);

const noApi = await hit("/api/console/home");
check("guarded API returns 401", noApi.status === 401, `status=${noApi.status}`);

const noPage = await hit("/copilot/1416");
const noPageTo = noPage.headers.get("location") || "";
check(
  "guarded page redirects to login",
  noPage.status >= 300 && noPage.status < 400 && noPageTo.includes("/copilot/login"),
  `${noPage.status} -> ${noPageTo}`
);

// The Google checks flip meaning with configuration state: unconfigured they
// must degrade, configured they must engage. The dev server reads the same
// .env.local, so this mirrors what it sees.
const googleConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

const loginPage = await hit("/copilot/login");
const loginHtml = await loginPage.text();
const hasButton = loginHtml.includes("Continue with Google");
check(
  googleConfigured
    ? "login page shows Google when configured"
    : "login page hides Google when unconfigured",
  loginPage.status === 200 && hasButton === googleConfigured,
  `status=${loginPage.status} button=${hasButton ? "shown" : "hidden"}`
);

console.log(
  googleConfigured ? "\nGOOGLE ROUTES (ANON KEY PRESENT)" : "\nGOOGLE ROUTES WITH NO ANON KEY"
);

const authorize = await hit("/api/copilot/auth/google");
const authorizeTo = authorize.headers.get("location") || "";
const redirected = authorize.status >= 300 && authorize.status < 400;
check(
  googleConfigured
    ? "authorize hands off to Supabase"
    : "authorize degrades to login",
  googleConfigured
    ? redirected && authorizeTo.includes("/auth/v1/authorize")
    : redirected && authorizeTo.includes("error=google_unavailable"),
  `${authorize.status} -> ${authorizeTo}`
);

// The PKCE verifier cookie set on the handoff is written by the same helper
// as the session cookies, so it proves httpOnly is forced on for sb-*.
if (googleConfigured) {
  const sbCookies = (authorize.headers.getSetCookie?.() || []).filter((c) =>
    c.trim().toLowerCase().startsWith("sb-")
  );
  check(
    "sb-* cookies from authorize are HttpOnly",
    sbCookies.length > 0 && sbCookies.every((c) => /;\s*httponly/i.test(c)),
    `count=${sbCookies.length}`
  );
}

const callback = await hit("/api/copilot/auth/callback?code=not-a-real-code");
const callbackTo = callback.headers.get("location") || "";
check(
  googleConfigured
    ? "callback rejects a junk code, fails closed"
    : "callback degrades to login",
  callback.status >= 300 &&
    callback.status < 400 &&
    callbackTo.includes("/copilot/login") &&
    (!googleConfigured || callbackTo.includes("error=google_failed")),
  `${callback.status} -> ${callbackTo}`
);

console.log("\nNEXT PATH CONFINEMENT (unit)");

const { safeNextPath } = await import(
  new URL("../src/lib/copilot/next-path.js", import.meta.url)
);

// [input, expected when the session resolved to az-test]
const nextVectors = [
  ["/copilot/az-test/runs/new", "/copilot/az-test/runs/new"],
  ["/copilot/az-test", "/copilot/az-test"],
  ["/copilot/az-test/../../onboard", "/copilot/az-test"],
  ["/copilot/az-test/%2e%2e/%2e%2e/onboard", "/copilot/az-test"],
  ["/copilot/az-test\\..\\..\\onboard", "/copilot/az-test"],
  ["/copilot/other-tenant/runs", "/copilot/az-test"],
  ["//evil.example/copilot/az-test", "/copilot/az-test"],
  ["https://evil.example/copilot/az-test", "/copilot/az-test"],
];
let confinementOk = true;
for (const [input, expected] of nextVectors) {
  const got = safeNextPath(input, "az-test");
  if (got !== expected || !got.startsWith("/copilot/")) {
    confinementOk = false;
    console.log(`        ${JSON.stringify(input)} -> ${got} (expected ${expected})`);
  }
}
check(
  "dot-segment and origin traversal confined",
  confinementOk,
  `${nextVectors.length} vectors`
);

console.log("\nTEST AGENT HAS NO LEGACY PASSWORD");

const testAgent = await postJson("/api/copilot/auth", {
  username: "test-auth",
  password: "deliberately-wrong",
});
check(
  "test-auth rejected by password form",
  testAgent.status === 401,
  `status=${testAgent.status}`
);

console.log("\nLEGACY SESSION STILL WORKS");

const login = await postJson("/api/copilot/auth", creds);
const loginBody = await login.json().catch(() => ({}));
check("legacy login succeeds", login.ok, `status=${login.status}`);

if (login.ok) {
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const slug = loginBody.tenantSlug;
  const other = slug === "1416" ? "condo-city" : "1416";

  const own = await hit(`/copilot/${slug}`, { headers: { cookie } });
  check("own tenant page loads", own.status === 200, `status=${own.status}`);

  const cross = await hit(`/copilot/${other}`, { headers: { cookie } });
  const crossTo = cross.headers.get("location") || "";
  check(
    "cross-tenant page redirects home",
    cross.status >= 300 && cross.status < 400 && crossTo.includes(`/copilot/${slug}`),
    `${cross.status} -> ${crossTo}`
  );

  const crossApi = await hit(`/api/copilot/${other}/chat`, { headers: { cookie } });
  check("cross-tenant API 403", crossApi.status === 403, `status=${crossApi.status}`);

  // Supabase sessions outrank the legacy cookie, so a successful password
  // login must expire any sb-* cookies riding along with the request.
  const stale = await hit("/api/copilot/auth", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "sb-qa-stale-auth-token.0=junk",
    },
    body: JSON.stringify(creds),
  });
  const staleCleared = (stale.headers.getSetCookie?.() || []).some(
    (c) => c.startsWith("sb-qa-stale-auth-token.0=") && /max-age=0/i.test(c)
  );
  check(
    "legacy login expires stale sb-* cookies",
    stale.ok && staleCleared,
    `status=${stale.status} cleared=${staleCleared}`
  );

  const logout = await hit("/api/copilot/auth", { method: "DELETE", headers: { cookie } });
  check("logout clears session", logout.ok, `status=${logout.status}`);
}

console.log(failures ? `\n${failures} check(s) failed.\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);

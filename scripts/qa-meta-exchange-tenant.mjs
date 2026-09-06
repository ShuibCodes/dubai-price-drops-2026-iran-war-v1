/**
 * Meta exchange tenant targeting — no Graph calls, no live writes.
 *
 * node scripts/qa-meta-exchange-tenant.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const { resolveMetaExchangeTarget } = await import(
  "../src/lib/meta/exchange-tenant.js"
);

const STERLING = {
  id: "tenant-sterling-oldest",
  slug: "sterling",
  created_at: "2026-07-04T00:00:00.000Z",
};
const UBAH = {
  id: "tenant-ubah",
  slug: "ubah",
  created_at: "2026-08-29T00:00:00.000Z",
};

function createMemorySupabase() {
  return {
    from() {
      throw new Error("anonymous slug lookup must not hit tenants");
    },
  };
}

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${detail || ""}`);
}

const supabase = createMemorySupabase();

console.log("\nANONYMOUS REJECTED");
{
  const none = await resolveMetaExchangeTarget({
    session: null,
    tenantSlug: UBAH.slug,
    supabase,
  });
  check(
    "anonymous request with tenant_slug is rejected",
    none.status === 401 && !none.tenantId,
    none.error
  );

  const blank = await resolveMetaExchangeTarget({
    session: null,
    tenantSlug: null,
    supabase,
  });
  check(
    "anonymous request without slug is rejected (not oldest tenant)",
    blank.status === 401 && !blank.tenantId && blank.tenantId !== STERLING.id
  );
}

console.log("\nAUTHENTICATED OWN TENANT");
{
  const hit = await resolveMetaExchangeTarget({
    session: { tenantId: UBAH.id, tenantSlug: UBAH.slug },
    tenantSlug: UBAH.slug,
    supabase,
  });
  check(
    "authenticated user can modify their own tenant",
    hit.tenantId === UBAH.id && !hit.error,
    hit.tenantId
  );

  const noSlug = await resolveMetaExchangeTarget({
    session: { tenantId: UBAH.id, tenantSlug: UBAH.slug },
    tenantSlug: null,
    supabase,
  });
  check(
    "existing valid exchange still uses session tenant (slug optional)",
    noSlug.tenantId === UBAH.id && !noSlug.error
  );
}

console.log("\nCROSS-TENANT REJECTED");
{
  const cross = await resolveMetaExchangeTarget({
    session: { tenantId: UBAH.id, tenantSlug: UBAH.slug },
    tenantSlug: STERLING.slug,
    supabase,
  });
  check(
    "cross-tenant tenant_slug is rejected",
    cross.status === 403 && !cross.tenantId,
    cross.error
  );
}

console.log("\nMISSING / UNKNOWN TENANT");
{
  const unknown = await resolveMetaExchangeTarget({
    session: null,
    tenantSlug: "does-not-exist",
    supabase,
  });
  check(
    "unknown slug without a session is 401, not a DB write",
    unknown.status === 401 && !unknown.tenantId,
    unknown.error
  );

  const mismatchUnknown = await resolveMetaExchangeTarget({
    session: { tenantId: UBAH.id, tenantSlug: UBAH.slug },
    tenantSlug: "does-not-exist",
    supabase,
  });
  check(
    "authenticated unknown slug that is not the session tenant is 403",
    mismatchUnknown.status === 403 && !mismatchUnknown.tenantId
  );
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;

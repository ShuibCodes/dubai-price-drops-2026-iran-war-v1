/**
 * Whautomate webhook tenant isolation — no live DB, no outbound send.
 *
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/qa-whautomate-tenant.mjs
 */
import {
  extractWhautomateChannelId,
  resolveWhautomateTenant,
} from "../src/lib/whautomate/tenant.js";

const STERLING = {
  id: "tenant-sterling",
  slug: "sterling",
  name: "Sterling",
  whautomate_channel_id: "whautomate-default",
  created_at: "2026-07-04T00:00:00.000Z",
};
const OTHER = {
  id: "tenant-1416",
  slug: "1416",
  name: "1416",
  whautomate_channel_id: "whautomate-1416",
  created_at: "2026-07-08T00:00:00.000Z",
};
const NO_CHANNEL = {
  id: "tenant-az-test",
  slug: "az-test",
  name: "az-test",
  whautomate_channel_id: null,
  created_at: "2026-08-01T00:00:00.000Z",
};

const SAMPLE_PAYLOAD = {
  event: { type: "incoming_whatsapp_message" },
  message: {
    isIncoming: true,
    channel: "whatsApp",
    contact: { phoneNumber: "971501234567", id: "contact-1", name: "Lead" },
    from: "Lead",
    text: "hello",
    id: "msg-1",
    timestamp: "2026-09-02T12:00:00.000Z",
  },
};

function createMemorySupabase(tenants) {
  const rows = [...tenants];
  return {
    from(table) {
      if (table !== "tenants") {
        throw new Error(`unexpected table ${table}`);
      }
      const filters = [];
      const chain = {
        select() {
          return chain;
        },
        eq(k, v) {
          filters.push([k, v]);
          return chain;
        },
        then(resolve, reject) {
          const matched = rows.filter((row) =>
            filters.every(([k, v]) => row[k] === v)
          );
          return Promise.resolve({ data: matched, error: null }).then(
            resolve,
            reject
          );
        },
      };
      return chain;
    },
  };
}

async function resolveFromRequest(supabase, payload, { url, headers } = {}) {
  const searchParams = url ? new URL(url).searchParams : null;
  const channelId = extractWhautomateChannelId(payload, {
    searchParams,
    headers: headers || null,
  });
  return resolveWhautomateTenant(supabase, channelId);
}

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(72)} ${detail || ""}`);
}

const supabase = createMemorySupabase([STERLING, OTHER, NO_CHANNEL]);
const oldestFirst = createMemorySupabase([STERLING, OTHER, NO_CHANNEL]);

console.log("\nEXTRACT CHANNEL ID");
{
  const ignored = extractWhautomateChannelId(SAMPLE_PAYLOAD);
  check(
    "standard payload message.channel=whatsApp is not a tenant key",
    ignored === null,
    String(ignored)
  );

  const fromQuery = extractWhautomateChannelId(SAMPLE_PAYLOAD, {
    searchParams: new URL(
      "https://example.com/api/whautomate/webhook?channel=whautomate-default"
    ).searchParams,
  });
  check(
    "query ?channel= is used",
    fromQuery === "whautomate-default",
    fromQuery
  );

  const fromHeader = extractWhautomateChannelId(SAMPLE_PAYLOAD, {
    headers: { "x-whautomate-channel": "whautomate-1416" },
  });
  check(
    "x-whautomate-channel header is used",
    fromHeader === "whautomate-1416",
    fromHeader
  );

  const fromBody = extractWhautomateChannelId({
    ...SAMPLE_PAYLOAD,
    location: { id: "loc-abc" },
  });
  check("optional body location.id is used", fromBody === "loc-abc", fromBody);

  const queryWins = extractWhautomateChannelId(
    { ...SAMPLE_PAYLOAD, location: { id: "loc-abc" } },
    {
      searchParams: new URL(
        "https://example.com/api/whautomate/webhook?channel=whautomate-default"
      ).searchParams,
      headers: { "x-whautomate-channel": "whautomate-1416" },
    }
  );
  check(
    "query channel wins over header and body",
    queryWins === "whautomate-default",
    queryWins
  );
}

console.log("\nTENANT RESOLUTION");
{
  const hit = await resolveFromRequest(supabase, SAMPLE_PAYLOAD, {
    url: "https://example.com/api/whautomate/webhook?channel=whautomate-1416",
  });
  check(
    "valid channel maps to the matching tenant (not first/oldest)",
    hit.tenant?.id === OTHER.id && !hit.reason,
    hit.tenant?.id
  );

  const unknown = await resolveFromRequest(supabase, SAMPLE_PAYLOAD, {
    url: "https://example.com/api/whautomate/webhook?channel=unknown-channel",
  });
  check(
    "unknown channel identifier is rejected",
    !unknown.tenant && unknown.reason === "unknown_channel",
    unknown.reason
  );

  const missing = await resolveFromRequest(oldestFirst, SAMPLE_PAYLOAD, {
    url: "https://example.com/api/whautomate/webhook",
  });
  check(
    "missing tenant/channel context is rejected (no first-tenant fallback)",
    !missing.tenant && missing.reason === "missing_channel",
    missing.reason
  );

  const stolen = await resolveFromRequest(supabase, SAMPLE_PAYLOAD, {
    url: "https://example.com/api/whautomate/webhook?channel=whautomate-default",
  });
  check(
    "one tenant cannot receive another tenant's webhook",
    stolen.tenant?.id === STERLING.id && stolen.tenant?.id !== OTHER.id,
    stolen.tenant?.id
  );

  const otherChannel = await resolveFromRequest(supabase, SAMPLE_PAYLOAD, {
    url: "https://example.com/api/whautomate/webhook?channel=whautomate-1416",
  });
  check(
    "1416 channel does not resolve to sterling",
    otherChannel.tenant?.id === OTHER.id &&
      otherChannel.tenant?.id !== STERLING.id,
    otherChannel.tenant?.id
  );

  const sterling = await resolveFromRequest(supabase, SAMPLE_PAYLOAD, {
    url: "https://example.com/api/whautomate/webhook?channel=whautomate-default",
  });
  check(
    "Sterling still maps when channel=whautomate-default is supplied",
    sterling.tenant?.id === STERLING.id &&
      sterling.tenant?.whautomate_channel_id === "whautomate-default",
    sterling.tenant?.id
  );
}

console.log("\nAMBIGUOUS CHANNEL");
{
  const dup = createMemorySupabase([
    STERLING,
    { ...OTHER, whautomate_channel_id: "whautomate-default" },
  ]);
  const hit = await resolveWhautomateTenant(dup, "whautomate-default");
  check(
    "duplicate channel id is rejected",
    !hit.tenant && hit.reason === "ambiguous_channel",
    hit.reason
  );
}

if (failures) {
  console.log(`\nFAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");

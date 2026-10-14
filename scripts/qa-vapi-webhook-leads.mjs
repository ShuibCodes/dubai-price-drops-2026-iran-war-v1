/**
 * Vapi webhook lead resolution — no live DB, no Vapi HTTP.
 *
 * node scripts/qa-vapi-webhook-leads.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const {
  findLeadByPhone,
  resolveCallTenantId,
  resolveCompletedCallContext,
  resolveWebhookLead,
} = await import("../src/lib/vapi/webhook-leads.js");

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const PHONE = "971501111111";
const LEAD_A = {
  id: "lead-a",
  tenant_id: TENANT_A,
  wa_id: PHONE,
  name: "A",
};
const LEAD_B = {
  id: "lead-b",
  tenant_id: TENANT_B,
  wa_id: PHONE,
  name: "B",
};

function createMemorySupabase({ leads = [], calls = [] } = {}) {
  const leadRows = [...leads];
  const callRows = [...calls];

  function filterRows(rows, filters, likes) {
    return rows.filter((row) => {
      const eqOk = filters.every(([k, v]) => row[k] === v);
      const likeOk = likes.every(([k, pattern]) => {
        const value = String(row[k] ?? "");
        const needle = String(pattern).replace(/%/g, "");
        return value.includes(needle);
      });
      return eqOk && likeOk;
    });
  }

  return {
    from(table) {
      const filters = [];
      const likes = [];
      const chain = {
        select() {
          return chain;
        },
        eq(k, v) {
          filters.push([k, v]);
          return chain;
        },
        like(k, v) {
          likes.push([k, v]);
          return chain;
        },
        limit() {
          return chain;
        },
        async maybeSingle() {
          const rows = table === "leads" ? leadRows : callRows;
          const matched = filterRows(rows, filters, likes);
          return { data: matched[0] || null, error: null };
        },
      };
      return chain;
    },
  };
}

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${detail || ""}`);
}

const supabase = createMemorySupabase({ leads: [LEAD_A, LEAD_B] });

console.log("\nSAME PHONE TWO TENANTS");
{
  const a = await findLeadByPhone(supabase, TENANT_A, `+${PHONE}`);
  const b = await findLeadByPhone(supabase, TENANT_B, `+${PHONE}`);
  check("tenant A phone lookup returns A", a?.id === LEAD_A.id);
  check("tenant B phone lookup returns B", b?.id === LEAD_B.id);
}

console.log("\nCALLBACK CANNOT AFFECT OTHER TENANT");
{
  const ctx = await resolveCompletedCallContext(supabase, {
    callId: "call-a",
    customerNumber: `+${PHONE}`,
    metadata: { tenantId: TENANT_A, leadId: LEAD_B.id },
  });
  check(
    "tenant A callback with B's leadIdHint does not return B",
    ctx.tenantId === TENANT_A && ctx.lead?.id === LEAD_A.id
  );

  const spoof = await resolveCompletedCallContext(
    createMemorySupabase({
      leads: [LEAD_A, LEAD_B],
      calls: [{ id: "row-a", tenant_id: TENANT_A, vapi_call_id: "call-a" }],
    }),
    {
      callId: "call-a",
      customerNumber: `+${PHONE}`,
      metadata: { tenantId: TENANT_B, leadId: LEAD_B.id },
    }
  );
  check(
    "existing tenant A call ignores spoofed tenant B metadata",
    spoof.tenantId === TENANT_A && spoof.lead?.id === LEAD_A.id
  );
}

console.log("\nLEAD ID HINT CANNOT BYPASS TENANT");
{
  const hint = await resolveWebhookLead(supabase, {
    tenantId: TENANT_A,
    leadIdHint: LEAD_B.id,
    phone: null,
  });
  check("leadIdHint for another tenant is ignored", hint == null);
}

console.log("\nMISSING TENANT FAILS CLOSED");
{
  const noTenant = await resolveWebhookLead(supabase, {
    tenantId: null,
    leadIdHint: LEAD_A.id,
    phone: `+${PHONE}`,
  });
  check("missing tenant does not fall back to global lead lookup", noTenant == null);

  const noMeta = await resolveCompletedCallContext(supabase, {
    callId: "call-orphan",
    customerNumber: `+${PHONE}`,
    metadata: {},
  });
  check(
    "missing tenant metadata fails safely",
    noMeta.tenantId == null && noMeta.lead == null
  );

  check(
    "resolveCallTenantId empty",
    resolveCallTenantId({ metadata: {} }) == null
  );
}

console.log("\nVALID CALLBACK");
{
  const ok = await resolveWebhookLead(supabase, {
    tenantId: TENANT_A,
    leadIdHint: LEAD_A.id,
    phone: `+${PHONE}`,
  });
  check("normal valid callback still resolves the tenant lead", ok?.id === LEAD_A.id);

  const byPhone = await resolveWebhookLead(supabase, {
    tenantId: TENANT_B,
    leadIdHint: "",
    phone: `+${PHONE}`,
  });
  check("valid callback by phone still works", byPhone?.id === LEAD_B.id);
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;

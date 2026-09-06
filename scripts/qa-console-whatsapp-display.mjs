/**
 * Tenant WhatsApp chrome must never fall back to agents.wa_id.
 *
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/qa-console-whatsapp-display.mjs
 */
import {
  tenantWhatsAppLink,
  whatsappHealthy,
} from "../src/lib/console/format.js";

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(64)} ${detail || ""}`);
}

const AGENT_WA = "971585690693";

console.log("\nCONNECTED TENANT");
{
  const tenant = {
    waba_id: "waba-1",
    phone_number_id: "phone-1",
    business_token: "token-1",
    display_phone: "+971 4 555 0100",
  };
  const connected = whatsappHealthy(tenant);
  const link = tenantWhatsAppLink({
    connected,
    displayPhone: tenant.display_phone,
  });
  check("whatsappHealthy is true when WABA + phone + token are set", connected);
  check(
    "connected UI links to the tenant display number",
    link === "https://wa.me/97145550100",
    link
  );
  check(
    "connected UI does not use the agent personal number",
    !String(link).includes(AGENT_WA)
  );
}

console.log("\nNO TENANT CONNECTION, AGENT HAS wa_id");
{
  const tenant = {
    waba_id: null,
    phone_number_id: null,
    business_token: null,
    display_phone: null,
  };
  const connected = whatsappHealthy(tenant);
  const mistakenFallback = tenant.display_phone || AGENT_WA;
  const link = tenantWhatsAppLink({
    connected,
    displayPhone: tenant.display_phone,
  });
  check("whatsappHealthy is false", connected === false);
  check(
    "tenantWhatsAppLink is null (not connected)",
    link === null,
    String(link)
  );
  check(
    "must not produce a wa.me link to the agent number",
    link !== `https://wa.me/${AGENT_WA}` &&
      !String(link || "").includes(AGENT_WA)
  );
  check(
    "old display_phone || agent.wa_id pattern is exactly what we now refuse",
    mistakenFallback === AGENT_WA && link === null
  );
}

console.log("\nCONNECTED FLAG TRUE BUT display_phone MISSING");
{
  const tenant = {
    waba_id: "waba-1",
    phone_number_id: "phone-1",
    business_token: "token-1",
    display_phone: null,
  };
  const connected = whatsappHealthy(tenant);
  const link = tenantWhatsAppLink({
    connected,
    displayPhone: tenant.display_phone,
  });
  check("still considered connected for the Meta flag", connected === true);
  check(
    "missing display_phone yields no wa.me link",
    link === null,
    String(link)
  );
  check(
    "missing display_phone does not fall back to agent.wa_id",
    link !== `https://wa.me/${AGENT_WA}`
  );
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;

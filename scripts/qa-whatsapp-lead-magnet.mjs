import assert from "node:assert/strict";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

const {
  extractListingUrlFromText,
  extractEmailFromText,
  parseClientName,
  handleLeadMagnetInbound,
  DEFAULT_PROMPT_REPLY,
  PDF_BUCKET,
} = await import("../src/lib/proposal/whatsapp-lead-magnet.js");
const { renderProposalPdfBuffer, buildProposalPdfFilename } = await import(
  "../src/lib/proposal/render-pdf.js"
);
const { getSupabaseServerClient } = await import("../src/lib/supabase/server.js");

console.log("1. Testing URL, email, and client name extraction...");
assert.equal(
  extractListingUrlFromText(
    "Prepared for Sarah Ahmed https://www.propertyfinder.ae/en/plp/buy/apartment-for-sale-dubai-marina-12345.html."
  ),
  "https://www.propertyfinder.ae/en/plp/buy/apartment-for-sale-dubai-marina-12345.html"
);
assert.equal(
  extractEmailFromText("send it to sarah.buyer@example.com please"),
  "sarah.buyer@example.com"
);
assert.deepEqual(
  parseClientName(
    "Prepared for Sarah Ahmed https://www.propertyfinder.ae/en/plp/buy/apartment-123.html"
  ),
  { clientName: "Sarah Ahmed", companyName: "" }
);
assert.deepEqual(parseClientName("hi"), { clientName: "", companyName: "" });

console.log("2. Testing server-side PDF rendering (Prepared for Sarah Ahmed)...");
const sampleListing = {
  title: "Full Marina View | High Floor | Upgraded 2BR",
  community: "DUBAI MARINA",
  price: "AED 2,850,000",
  bedrooms: 2,
  bathrooms: 3,
  sizeSqft: 1420,
  propertyType: "Apartment",
  furnishing: "Furnished",
  parking: "1 covered space",
  serviceCharge: "AED 18 / sq ft",
  floor: "34",
  view: "Full MarinaView",
  completionStatus: "Ready",
  developer: "Emaar",
  yearBuilt: "2019",
  ownership: "Freehold",
  summary:
    "Bright corner layout with floor-to-ceiling windows overlooking the marina.",
  highlights: [
    "Upgraded open kitchen with Miele appliances",
    "Chiller free building with direct marina walk access",
    "Vacant on transfer",
  ],
  nearby: ["DMCC Metro (5 min)", "Dubai Marina Mall"],
  amenities: ["Pool", "Gym", "Balcony", "Covered parking"],
  images: [],
  preparedFor: "Sarah Ahmed",
  agentPhone: "+971500000099",
};

const pdfBuffer = await renderProposalPdfBuffer(sampleListing);
assert.ok(pdfBuffer.length > 1000, "PDF buffer should be non-empty");
assert.equal(pdfBuffer.subarray(0, 5).toString("ascii"), "%PDF-");
const filename = buildProposalPdfFilename(sampleListing);
assert.equal(filename, "Prepared_for_Sarah_Ahmed_DUBAI_MARINA_2BR_one_pager.pdf");
console.log(`   PDF rendered (${pdfBuffer.length} bytes), filename=${filename}`);

console.log("3. Testing Supabase Storage upload + public URL...");
const supabase = getSupabaseServerClient();
assert.ok(supabase, "Supabase client required");
const testWaId = "971500000099";
const testPath = `${testWaId}/qa_test_${filename}`;
const { error: uploadErr } = await supabase.storage
  .from(PDF_BUCKET)
  .upload(testPath, pdfBuffer, { contentType: "application/pdf", upsert: true });
assert.ifError(uploadErr);

const { data: pubData } = supabase.storage.from(PDF_BUCKET).getPublicUrl(testPath);
assert.ok(pubData?.publicUrl?.startsWith("https://"));
const headRes = await fetch(pubData.publicUrl);
assert.equal(headRes.status, 200);

console.log("4. Testing multi-turn state machine in handleLeadMagnetInbound...");
await supabase.from("whatsapp_lead_magnet_users").delete().eq("wa_id", testWaId);

// Turn A: Greeting without link -> default prompt reply
const turnA = await handleLeadMagnetInbound({
  from: `whatsapp:+${testWaId}`,
  to: "whatsapp:+971501234567",
  body: "Hello!",
  callerWaId: testWaId,
});
assert.equal(turnA.replyText, DEFAULT_PROMPT_REPLY);
assert.equal(turnA.backgroundPromise, null);

// Turn B: Link without buyer name -> asks for buyer/tenant name
const turnB = await handleLeadMagnetInbound({
  from: `whatsapp:+${testWaId}`,
  to: "whatsapp:+971501234567",
  body: "https://www.propertyfinder.ae/en/plp/buy/apartment-for-sale-dubai-12345.html",
  callerWaId: testWaId,
});
assert.equal(turnB.handled, true);
assert.match(turnB.replyText, /Prepared for/i);
assert.equal(turnB.backgroundPromise, null);

console.log("5. Testing registered-agent flow (Jarvis passthrough + PDF link interception)...");
const agentWaId = "971500000098";
await supabase.from("whatsapp_lead_magnet_users").delete().eq("wa_id", agentWaId);
const mockSender = {
  waId: agentWaId,
  agentId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000002",
  agentName: "Shuayb",
};

// Normal Jarvis message -> handled: false
const agentNormal = await handleLeadMagnetInbound({
  from: `whatsapp:+${agentWaId}`,
  to: "whatsapp:+971501234567",
  body: "call my hot leads from yesterday",
  callerWaId: agentWaId,
  sender: mockSender,
});
assert.equal(agentNormal.handled, false);

// Agent sends PF link without prospect name -> handled: true, prompts for prospect name
const agentLinkOnly = await handleLeadMagnetInbound({
  from: `whatsapp:+${agentWaId}`,
  to: "whatsapp:+971501234567",
  body: "https://www.propertyfinder.ae/en/plp/buy/apartment-for-sale-dubai-marina-999.html",
  callerWaId: agentWaId,
  sender: mockSender,
});
assert.equal(agentLinkOnly.handled, true);
assert.match(agentLinkOnly.replyText, /Prepared for/i);

// Clean up QA artifacts
await supabase.storage.from(PDF_BUCKET).remove([testPath]);
await supabase
  .from("whatsapp_lead_magnet_users")
  .delete()
  .in("wa_id", [testWaId, agentWaId]);

console.log("ALL QA CHECKS PASSED!");

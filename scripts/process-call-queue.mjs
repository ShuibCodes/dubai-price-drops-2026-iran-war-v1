import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { isWithinBusinessHours } from "../src/lib/calls/business-hours.js";
import { buildPropertyInterest } from "../src/lib/leads/normalize.js";
import { startLeadCall } from "../src/lib/vapi/dial.js";

applyEnv(loadEnvFile());

async function main() {
  if (!isWithinBusinessHours()) {
    console.log("Outside business hours — exiting quietly.");
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date().toISOString();

  const { data: queueRows, error } = await supabase
    .from("call_queue")
    .select("id, tenant_id, lead_id, scheduled_for, leads(*), tenants(*)")
    .eq("processed", false)
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(20);

  if (error) {
    console.error("Queue query failed:", error.message);
    process.exit(1);
  }

  if (!queueRows?.length) {
    console.log("No due queue items.");
    return;
  }

  let processed = 0;
  let failed = 0;

  for (const item of queueRows) {
    const lead = item.leads;
    const tenant = item.tenants;
    if (!lead || !tenant) {
      await supabase.from("call_queue").update({ processed: true }).eq("id", item.id);
      continue;
    }

    const leadName = lead.push_name || "there";
    const phone = lead.wa_id ? `+${lead.wa_id}` : null;
    if (!phone) {
      await supabase.from("call_queue").update({ processed: true }).eq("id", item.id);
      continue;
    }

    const propertyInterest = buildPropertyInterest({});
    const leadSource = lead.source || "one of the property portals";

    try {
      const result = await startLeadCall({
        name: leadName,
        phone,
        assistantId: tenant.vapi_assistant_id,
        phoneNumberId: tenant.vapi_phone_number_id,
        variableValues: { leadName, leadSource, propertyInterest, campaignTopic: "", formWhen: "", ownsProperty: "" },
        metadata: {
          tenantId: tenant.id,
          leadId: lead.id,
          pixxiLeadId: lead.pixxi_lead_id,
          source: "pixxi-queue",
        },
      });

      await supabase.from("calls").insert({
        tenant_id: tenant.id,
        lead_id: lead.id,
        vapi_call_id: result.callId,
        direction: "outbound",
        status: "initiated",
        raw: result.raw,
      });

      await supabase.from("call_queue").update({ processed: true }).eq("id", item.id);
      processed += 1;
      console.log(`Processed queue item ${item.id} → call ${result.callId}`);
    } catch (err) {
      failed += 1;
      console.error(`Failed queue item ${item.id}: ${err.message}`);
    }
  }

  console.log(`Queue drain complete: ${processed} processed, ${failed} failed`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

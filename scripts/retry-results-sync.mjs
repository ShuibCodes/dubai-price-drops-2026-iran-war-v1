import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import {
  flatPayload,
  resultsWebhookUrlForTenant,
} from "../src/lib/notify/results-hook.js";

applyEnv(loadEnvFile());

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: calls, error } = await supabase
    .from("calls")
    .select("*, leads(*), tenants(slug)")
    .eq("status", "completed")
    .eq("results_synced", false)
    .gte("ended_at", since)
    .order("ended_at", { ascending: true });

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  if (!calls?.length) {
    console.log("No unsynced calls in the last 7 days.");
    return;
  }

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const call of calls) {
    const lead = call.leads;
    const tenantSlug = call.tenants?.slug || "";
    const webhookUrl = resultsWebhookUrlForTenant(tenantSlug);
    if (!webhookUrl) {
      skipped += 1;
      console.log(`Skip ${call.vapi_call_id}: no webhook for tenant=${tenantSlug || "?"}`);
      continue;
    }

    const qualification = call.qualification || {};
    const payload = flatPayload(call, lead, qualification, tenantSlug);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        failed += 1;
        console.error(`Failed ${call.vapi_call_id}: HTTP ${response.status}`);
        continue;
      }

      await supabase
        .from("calls")
        .update({
          results_synced: true,
          results_synced_at: new Date().toISOString(),
        })
        .eq("id", call.id);

      synced += 1;
      console.log(`Synced ${call.vapi_call_id} → ${tenantSlug || "default"}`);
    } catch (err) {
      failed += 1;
      console.error(`Failed ${call.vapi_call_id}: ${err.message}`);
    }
  }

  console.log(
    `Done: ${synced} synced, ${failed} failed, ${skipped} skipped, ${calls.length} total`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

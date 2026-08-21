import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { createClient } from "@supabase/supabase-js";
import { briefDueToday, sendMorningBrief } from "../src/lib/brief/send.js";

applyEnv(loadEnvFile());

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: agents, error } = await supabase
    .from("agents")
    .select(
      "id, name, wa_id, tenant_id, brief_enabled, brief_time, tz, last_brief_sent_on, tenants(id, phone_number_id, business_token, waba_id)"
    )
    .eq("brief_enabled", true);
  if (error) throw new Error(error.message);

  const now = new Date();
  let sent = 0;
  for (const agent of agents || []) {
    if (!briefDueToday(agent, now)) continue;
    const result = await sendMorningBrief({
      supabase,
      tenant: agent.tenants,
      agent,
    });
    console.log(`brief agent=${agent.id} sent=${result.sent} via=${result.via || result.reason}`);
    if (result.sent) sent += 1;
  }
  console.log(`morning briefs sent=${sent}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

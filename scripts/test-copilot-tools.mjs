import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import {
  countCallsSince,
  getLeadStory,
  getPendingCallbacks,
  searchConversations,
  searchLeadByName,
  todaysDigest,
} from "../src/lib/copilot/tools.js";

applyEnv(loadEnvFile());

async function main() {
  const slug = process.argv[2] || "1416";
  const leadQuery = process.argv[3] || "a";
  const conversationQuery = process.argv[4] || "property";
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!tenant) throw new Error(`Tenant not found: ${slug}`);

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [counts, digest, leads, callbacks, conversationHits] = await Promise.all([
    countCallsSince(tenant.id, since),
    todaysDigest(tenant.id),
    searchLeadByName(tenant.id, leadQuery),
    getPendingCallbacks(tenant.id),
    searchConversations(tenant.id, conversationQuery),
  ]);
  const story = leads[0]?.id ? await getLeadStory(tenant.id, leads[0].id) : null;

  console.log(
    JSON.stringify(
      {
        tenant,
        countCallsSince: counts,
        todaysDigest: digest,
        searchLeadByName: leads,
        getLeadStory: story,
        getPendingCallbacks: callbacks,
        searchConversations: conversationHits,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

import { spawnSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing Supabase env vars");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: tableError } = await supabase.from("tenants").select("id").limit(1);
  if (tableError) {
    console.error("Database not ready:", tableError.message);
    console.error("Apply supabase/migrations/001_whatsapp.sql first.");
    process.exit(1);
  }

  const agentWaId = String(process.env.SEED_AGENT_WA_ID || "971586689688").replace(/\D/g, "");
  const webhookUrl = process.argv[2] || "http://localhost:3000/api/meta/webhook";
  const whatsappUrl = process.argv[3] || "http://localhost:3000/api/whatsapp";

  console.log("Running simulator...");
  const sim = spawnSync("node", ["scripts/simulate-meta.mjs", "all", webhookUrl], {
    stdio: "inherit",
    env: process.env,
  });

  if (sim.status !== 0) {
    process.exit(sim.status || 1);
  }

  console.log("Querying KB via WhatsApp route...");
  const curl = spawnSync(
    "curl",
    [
      "-s",
      "-X",
      "POST",
      whatsappUrl,
      "-F",
      `From=whatsapp:+${agentWaId}`,
      "-F",
      "Body=what did Ahmed want?",
      "-F",
      "MessageSid=verify-coexistence-1",
    ],
    { encoding: "utf8" }
  );

  const output = String(curl.stdout || "");
  console.log(output);

  const lower = output.toLowerCase();
  if (lower.includes("not registered")) {
    console.error("Agent is not seeded. Run: node scripts/seed-tenant.mjs");
    process.exit(1);
  }

  if (lower.includes("ahmed") && (lower.includes("marina") || lower.includes("2br") || lower.includes("2 br"))) {
    console.log("Verification passed.");
    return;
  }

  console.warn("Reply received but did not clearly mention Ahmed's Marina request.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

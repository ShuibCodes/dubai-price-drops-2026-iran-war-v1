import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { createClient } from "@supabase/supabase-js";
import { processMeetingReminders } from "../src/lib/calendar/reminders.js";

applyEnv(loadEnvFile());

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  console.log(`[meeting-reminders] checking upcoming appointments at ${now.toISOString()}...`);

  const outcome = await processMeetingReminders({
    supabase,
    now,
  });

  console.log(
    `[meeting-reminders] found=${outcome.found} sent=${outcome.sent}`
  );
  for (const res of outcome.results) {
    console.log(
      `  appointment=${res.appointmentId} sent=${res.sent} via=${res.via || res.reason}`
    );
  }
}

main().catch((error) => {
  console.error("[meeting-reminders] fatal error:", error.message);
  process.exitCode = 1;
});

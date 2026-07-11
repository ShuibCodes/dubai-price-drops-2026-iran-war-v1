import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { sendWhautomateText } from "../src/lib/whautomate/send.js";

applyEnv(loadEnvFile());

async function main() {
  const phone = process.argv[2];
  const text =
    process.argv.slice(3).join(" ").trim() ||
    "AgentZero test message — please ignore.";

  if (!phone) {
    console.error("Usage: node scripts/test-whautomate-send.mjs <phoneDigits> [message...]");
    console.error("Example: node scripts/test-whautomate-send.mjs 971585690693 Hello");
    process.exit(1);
  }

  if (!process.env.WHAUTOMATE_API_KEY || !process.env.WHAUTOMATE_API_BASE) {
    console.error("Set WHAUTOMATE_API_KEY and WHAUTOMATE_API_BASE in .env.local");
    process.exit(1);
  }

  console.log(`Sending to ${phone.replace(/\d(?=\d{3})/g, "*")}…`);
  const result = await sendWhautomateText({
    phoneNumber: phone,
    name: "Test",
    text,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

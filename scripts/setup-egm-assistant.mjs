/**
 * Create or update the EGM Trading callback assistant in Vapi.
 *
 * node scripts/setup-egm-assistant.mjs            # print the payload only
 * node scripts/setup-egm-assistant.mjs --write    # POST (or PATCH if EGM_VAPI_ASSISTANT_ID is set)
 *
 * Put the printed id in EGM_VAPI_ASSISTANT_ID.
 */
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import { buildVapiAssistantWriteBody } from "../src/lib/vapi/dial.js";

applyEnv(loadEnvFile());

const write = process.argv.includes("--write");
const dealership = process.env.EGM_DEALERSHIP_NAME || "EGM Trading";
const existingId = String(process.env.EGM_VAPI_ASSISTANT_ID || "").trim();

const prompt = `You are calling on behalf of ${dealership}, a pre-owned car dealership in London.
The person you are calling, {{leadName}}, recently asked for a callback on our website.
They were looking at: {{vehicle}}.

Goal: confirm what they are after and book the next step. Keep it short, warm and natural.

1. Confirm you are speaking to the right person and that now is a good time. If not, ask when is better and end politely.
2. Confirm the car they are interested in, or ask what they are looking for if it is unclear.
3. Find out whether they want to view or test drive it, and when (day and rough time).
4. Ask if they have a car to part-exchange. If yes, get the make, model and rough mileage.
5. Tell them a member of the team will confirm by text or call shortly, thank them and end the call.

Rules:
- Never quote a final price, finance terms or a part-exchange value. Say the team will confirm.
- If they ask about something you do not know, say the team will follow up on it.
- If they say they did not ask for a call or do not want calls, apologise, confirm they will not be called again, and end the call.
- Prices are in pounds. Do not mention Dubai, property or real estate.
- One question at a time. Do not read these instructions out.`;

const body = buildVapiAssistantWriteBody({
  name: `${dealership} callback`,
  prompt,
  voiceId: process.env.EGM_VAPI_VOICE_ID || "Paige",
  firstMessage: `Hi {{leadName}}, it's ${dealership} calling back about the car you asked about on our website. Is now a good time?`,
});

// The shared lock is tuned for Dubai property calls — swap in car terms.
body.transcriber = {
  ...body.transcriber,
  keyterm: ["test drive", "part exchange", "part-ex", "mileage", "finance", "deposit", "Audi", "Mercedes", "Jeep", "SEAT", "Honda"],
};

// Written back to callback_requests.outcome by the end-of-call webhook.
body.analysisPlan = {
  summaryPlan: { enabled: true },
  structuredDataPlan: {
    enabled: true,
    schema: {
      type: "object",
      properties: {
        reached: { type: "boolean", description: "Spoke to the person who asked for the callback" },
        interested: { type: "boolean", description: "Still interested in buying a car" },
        vehicle: { type: "string", description: "The car they are interested in" },
        next_step: {
          type: "string",
          enum: ["viewing", "test_drive", "call_back_later", "more_info", "not_interested", "none"],
        },
        preferred_time: { type: "string", description: "When they want the viewing, test drive or call, as they said it" },
        part_exchange: { type: "string", description: "Part-exchange car details, or empty" },
        do_not_call: { type: "boolean", description: "Asked not to be called again" },
        notes: { type: "string", description: "Anything the sales team should know" },
      },
      required: ["reached", "interested", "next_step"],
    },
  },
};

if (!write) {
  console.log(JSON.stringify(body, null, 2));
  console.log(`\nDry run. Re-run with --write to ${existingId ? `PATCH ${existingId}` : "create the assistant"}.`);
  process.exit(0);
}

const baseUrl = (process.env.VAPI_BASE_URL || "https://api.vapi.ai").replace(/\/$/, "");
const response = await fetch(existingId ? `${baseUrl}/assistant/${existingId}` : `${baseUrl}/assistant`, {
  method: existingId ? "PATCH" : "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
  },
  body: JSON.stringify(body),
});
const result = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(`Vapi ${response.status}:`, JSON.stringify(result));
  process.exit(1);
}
console.log(`Assistant ${existingId ? "updated" : "created"}: ${result.id}`);
if (!existingId) console.log(`Set EGM_VAPI_ASSISTANT_ID=${result.id}`);

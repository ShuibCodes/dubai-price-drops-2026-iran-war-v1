import crypto from "crypto";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

const PHONE_NUMBER_ID = "111000111000111";
const DISPLAY_PHONE = "+971501111111";
const BUSINESS_WABA_ID = "999888777666555";

const LEAD_AHMED = {
  waId: "971501234567",
  pushName: "Ahmed",
};

const LEAD_SARA = {
  waId: "971509876543",
  pushName: "Sara",
};

function unixNow(offsetSeconds = 0) {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

function buildBasePayload({ messages = [], contacts = [], echoes = [] }) {
  const value = {
    messaging_product: "whatsapp",
    metadata: {
      display_phone_number: DISPLAY_PHONE,
      phone_number_id: PHONE_NUMBER_ID,
    },
  };

  if (messages.length) value.messages = messages;
  if (contacts.length) value.contacts = contacts;
  if (echoes.length) value.message_echoes = echoes;

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: BUSINESS_WABA_ID,
        changes: [
          {
            field: "messages",
            value,
          },
        ],
      },
    ],
  };
}

function buildInboundText({ waId, pushName, text, messageId, timestamp }) {
  return {
    payload: buildBasePayload({
      contacts: [
        {
          profile: { name: pushName },
          wa_id: waId,
        },
      ],
      messages: [
        {
          from: waId,
          id: messageId,
          timestamp: String(timestamp),
          type: "text",
          text: { body: text },
        },
      ],
    }),
    label: `inbound text from ${pushName}`,
  };
}

function buildOutboundEcho({ leadWaId, text, messageId, timestamp }) {
  return {
    payload: buildBasePayload({
      echoes: [
        {
          from: PHONE_NUMBER_ID,
          to: leadWaId,
          id: messageId,
          timestamp: String(timestamp),
          type: "text",
          text: { body: text },
        },
      ],
    }),
    label: "outbound echo from phone app",
  };
}

const SCENARIOS = {
  inbound1: () =>
    buildInboundText({
      waId: LEAD_AHMED.waId,
      pushName: LEAD_AHMED.pushName,
      text: "Hi, I am looking for a 2BR in Dubai Marina under 2M AED. Can you help?",
      messageId: "wamid.sim.inbound1",
      timestamp: unixNow(-7200),
    }),

  inbound2: () =>
    buildInboundText({
      waId: LEAD_AHMED.waId,
      pushName: LEAD_AHMED.pushName,
      text: "Ideally ready to move in before September.",
      messageId: "wamid.sim.inbound2",
      timestamp: unixNow(-3600),
    }),

  echo: () =>
    buildOutboundEcho({
      leadWaId: LEAD_AHMED.waId,
      text: "Yes Ahmed, I have a few Marina options under 2M. Sending details shortly.",
      messageId: "wamid.sim.echo1",
      timestamp: unixNow(-1800),
    }),

  lead2: () =>
    buildInboundText({
      waId: LEAD_SARA.waId,
      pushName: LEAD_SARA.pushName,
      text: "Do you have any JVC townhouses available this month?",
      messageId: "wamid.sim.lead2",
      timestamp: unixNow(-900),
    }),
};

function signBody(rawBody, appSecret) {
  return `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

async function postScenario({ url, appSecret, scenarioKey }) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioKey}`);
  }

  const { payload, label } = scenario();
  const rawBody = JSON.stringify(payload);
  const signature = signBody(rawBody, appSecret);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature,
    },
    body: rawBody,
  });

  const text = await response.text();
  console.log(`[${scenarioKey}] ${label} -> ${response.status} ${text}`);
}

function printUsage() {
  console.log(`Usage: node scripts/simulate-meta.mjs [scenario|all] [webhookUrl]

Scenarios:
  inbound1   inbound text from Ahmed
  inbound2   second inbound from Ahmed
  echo       outbound echo (phone reply)
  lead2      inbound from second lead
  all        run all scenarios in order

Default webhook URL: http://localhost:3000/api/meta/webhook`);
}

async function main() {
  const [, , scenarioArg = "all", urlArg] = process.argv;
  const webhookUrl = urlArg || "http://localhost:3000/api/meta/webhook";
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    console.error("Missing META_APP_SECRET in .env.local");
    process.exit(1);
  }

  if (scenarioArg === "help" || scenarioArg === "--help") {
    printUsage();
    return;
  }

  const scenarios =
    scenarioArg === "all"
      ? ["inbound1", "inbound2", "echo", "lead2"]
      : [scenarioArg];

  for (const scenarioKey of scenarios) {
    await postScenario({ url: webhookUrl, appSecret, scenarioKey });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

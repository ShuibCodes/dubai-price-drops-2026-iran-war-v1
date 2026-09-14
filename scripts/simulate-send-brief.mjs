/**
 * MANUAL TEST UTILITY — Morning Brief button half only.
 *
 * Posts a signed Meta-shaped `send_brief` button_reply to /api/meta/webhook
 * so the EXISTING production handler can send the owned brief as Cloud text.
 *
 * Does NOT send the notification template. Does NOT change WA_TEMPLATE_BRIEF.
 * Do not run until a connected tenant + test agent wa_id are explicitly approved.
 *
 * Usage:
 *   node scripts/simulate-send-brief.mjs --help
 *   node scripts/simulate-send-brief.mjs --dry-run --phone-number-id <id> --from <wa_id>
 *   node scripts/simulate-send-brief.mjs --phone-number-id <id> --from <wa_id> --twice
 */
import crypto from "crypto";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

function parseArgs(argv) {
  const args = {
    phoneNumberId: null,
    from: null,
    url: "http://localhost:3000/api/meta/webhook",
    messageId: null,
    wabaId: "waba.test",
    displayPhone: "0",
    twice: false,
    dryRun: false,
    allowRemote: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => String(argv[++i] || "").trim();
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--twice") args.twice = true;
    else if (a === "--allow-remote") args.allowRemote = true;
    else if (a === "--phone-number-id") args.phoneNumberId = next();
    else if (a === "--from") args.from = next().replace(/\D/g, "");
    else if (a === "--url") args.url = next();
    else if (a === "--message-id") args.messageId = next();
    else if (a === "--waba-id") args.wabaId = next();
    else if (a === "--display-phone") args.displayPhone = next();
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function signBody(rawBody, appSecret) {
  return `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex")}`;
}

function buildPayload({ phoneNumberId, displayPhone, wabaId, from, messageId }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: displayPhone,
                phone_number_id: phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: "Morning Brief test agent" },
                  wa_id: from,
                },
              ],
              messages: [
                {
                  from,
                  id: messageId,
                  timestamp,
                  type: "interactive",
                  interactive: {
                    type: "button_reply",
                    button_reply: {
                      id: "send_brief",
                      title: "Send brief",
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function printUsage() {
  console.log(`Manual Morning Brief send_brief webhook test.

Required:
  --phone-number-id   tenants.phone_number_id of the CONNECTED test tenant
  --from              agents.wa_id of the approved test agent (digits)

Optional:
  --url               default http://localhost:3000/api/meta/webhook
  --message-id        default wamid.brief-test.<timestamp>
  --twice             POST the same wa_message_id twice (duplicate lock)
  --dry-run           print payload, do not POST
  --allow-remote      required if --url is not localhost
  --waba-id           payload entry id only; unused for tenant resolve
  --display-phone     metadata display number only; unused for tenant resolve

The running Next server must have the same META_APP_SECRET used to sign.
Do not set SKIP_META_SIG on production. Local skip is optional: this script
always sends X-Hub-Signature-256.

Before running: the test agent must already have messaged the business
WhatsApp number (24-hour Cloud session). Then:

  npm run dev
  node scripts/simulate-send-brief.mjs --phone-number-id <id> --from <wa_id> --twice`);
}

async function postOnce({ url, rawBody, appSecret }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signBody(rawBody, appSecret),
    },
    body: rawBody,
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!args.phoneNumberId || !args.from) {
    printUsage();
    throw new Error("Refusing to send: --phone-number-id and --from are required");
  }

  if (!isLocalUrl(args.url) && !args.allowRemote) {
    throw new Error(
      `Refusing non-local webhook ${args.url}. Pass --allow-remote only after the test tenant/agent are approved.`
    );
  }

  const appSecret = process.env.META_APP_SECRET;
  if (!args.dryRun && !appSecret) {
    throw new Error("Missing META_APP_SECRET (needed to sign X-Hub-Signature-256)");
  }

  const messageId =
    args.messageId || `wamid.brief-test.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;

  const payload = buildPayload({
    phoneNumberId: args.phoneNumberId,
    displayPhone: args.displayPhone,
    wabaId: args.wabaId,
    from: args.from,
    messageId,
  });
  const rawBody = JSON.stringify(payload);

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        url: args.url,
        phone_number_id: args.phoneNumberId,
        from: args.from,
        wa_message_id: messageId,
        button_id: "send_brief",
        twice: args.twice,
      },
      null,
      2
    )
  );

  if (args.dryRun) {
    console.log(rawBody);
    return;
  }

  const first = await postOnce({ url: args.url, rawBody, appSecret });
  console.log(`first -> ${first.status} ${first.text}`);

  if (args.twice) {
    const second = await postOnce({ url: args.url, rawBody, appSecret });
    console.log(`duplicate -> ${second.status} ${second.text}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

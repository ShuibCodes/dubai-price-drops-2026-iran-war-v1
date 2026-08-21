const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";

const TEMPLATE_BRIEF =
  process.env.WA_TEMPLATE_BRIEF || "agentzero_morning_brief";
const TEMPLATE_RUN =
  process.env.WA_TEMPLATE_RUN_SUMMARY || "agentzero_run_summary";
const TEMPLATE_LANG = process.env.WA_TEMPLATE_LANG || "en";

function graphUrl(phoneNumberId) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
}

async function graphSend(phoneNumberId, businessToken, payload) {
  const response = await fetch(graphUrl(phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${businessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      ...payload,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(result?.error?.message || `Graph API error ${response.status}`);
    err.code = result?.error?.code;
    err.subcode = result?.error?.error_subcode;
    throw err;
  }
  return result;
}

export function isOutsideServiceWindowError(error) {
  const code = Number(error?.code);
  const text = String(error?.message || "");
  return (
    code === 131047 ||
    code === 131026 ||
    /24[\s-]?hour|re-engagement|outside the .*window/i.test(text)
  );
}

export async function sendCloudText({ phoneNumberId, businessToken, toWaId, body }) {
  const text = String(body || "").trim();
  if (!text) throw new Error("Refusing to send empty WhatsApp body");
  if (!phoneNumberId || !businessToken || !toWaId) {
    throw new Error("WhatsApp sender or destination missing");
  }
  return graphSend(phoneNumberId, businessToken, {
    to: String(toWaId).replace(/\D/g, ""),
    type: "text",
    text: { body: text.slice(0, 4096) },
  });
}

export async function sendCloudTemplate({
  phoneNumberId,
  businessToken,
  toWaId,
  name,
  language = TEMPLATE_LANG,
  bodyParams = [],
}) {
  if (!phoneNumberId || !businessToken || !toWaId || !name) {
    throw new Error("WhatsApp template send is missing fields");
  }
  const components = [];
  if (bodyParams.length) {
    components.push({
      type: "body",
      parameters: bodyParams.map((text) => ({
        type: "text",
        text: String(text || " ").slice(0, 1024),
      })),
    });
  }
  return graphSend(phoneNumberId, businessToken, {
    to: String(toWaId).replace(/\D/g, ""),
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(components.length ? { components } : {}),
    },
  });
}

/**
 * Prefer free-form text while the 24-hour service window is open.
 * On Meta's re-engagement error, fall back to an approved template.
 */
export async function sendAgentCloudMessage({
  tenant,
  toWaId,
  body,
  templateName,
  templateParams = [],
}) {
  if (!tenant?.phone_number_id || !tenant?.business_token) {
    return { sent: false, reason: "no_sender_configured" };
  }
  try {
    await sendCloudText({
      phoneNumberId: tenant.phone_number_id,
      businessToken: tenant.business_token,
      toWaId,
      body,
    });
    return { sent: true, via: "text" };
  } catch (error) {
    if (!isOutsideServiceWindowError(error) || !templateName) {
      return { sent: false, reason: error.message };
    }
    try {
      await sendCloudTemplate({
        phoneNumberId: tenant.phone_number_id,
        businessToken: tenant.business_token,
        toWaId,
        name: templateName,
        bodyParams: templateParams.length ? templateParams : [String(body || "").slice(0, 500)],
      });
      return { sent: true, via: "template", template: templateName };
    } catch (templateError) {
      return { sent: false, reason: templateError.message };
    }
  }
}

export { TEMPLATE_BRIEF, TEMPLATE_RUN };

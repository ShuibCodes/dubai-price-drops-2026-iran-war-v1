/**
 * Whautomate WhatsApp send adapter.
 * Docs use the misspelled field name "recepient" — keep it verbatim.
 */

function getApiConfig() {
  const apiKey = process.env.WHAUTOMATE_API_KEY;
  const base = String(process.env.WHAUTOMATE_API_BASE || "")
    .trim()
    .replace(/\/$/, "");
  if (!apiKey) throw new Error("Missing WHAUTOMATE_API_KEY");
  if (!base) throw new Error("Missing WHAUTOMATE_API_BASE");
  return { apiKey, base };
}

function digitsOnlyPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * @param {{ contactId?: string|null, phoneNumber?: string|null, name?: string|null, text: string }} opts
 * @returns {Promise<{ ok: boolean, raw: any }>}
 */
export async function sendWhautomateText({ contactId, phoneNumber, name, text }) {
  const bodyText = String(text || "").trim();
  if (!bodyText) {
    return { ok: false, raw: { error: "empty_text" } };
  }

  const { apiKey, base } = getApiConfig();
  const payload = { textMessage: bodyText };

  const id = String(contactId || "").trim();
  if (id) {
    payload.contact = { id };
  } else {
    const phone = digitsOnlyPhone(phoneNumber);
    if (!phone) {
      return { ok: false, raw: { error: "missing_contact_and_phone" } };
    }
    payload.recepient = {
      phoneNumber: phone,
      name: String(name || "").trim() || "Lead",
    };
  }

  const response = await fetch(`${base}/v1/messages/whatsapp/sendtext`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.json().catch(() => ({}));
  const ok = response.ok && (raw?.success === true || raw?.success === "true" || response.status < 300);
  if (!ok) {
    console.error(
      `[whautomate/send] failed status=${response.status} body=${JSON.stringify(raw).slice(0, 300)}`
    );
  }
  return { ok, raw };
}

/**
 * Whautomate WhatsApp send adapter.
 * OpenAPI requires location.id + textMessage; addressing via contact.id
 * or recepient.phoneNumber (their misspelling — keep verbatim).
 */

function getApiConfig() {
  const apiKey = process.env.WHAUTOMATE_API_KEY;
  const base = String(process.env.WHAUTOMATE_API_BASE || "")
    .trim()
    .replace(/\/$/, "");
  const locationId = String(process.env.WHAUTOMATE_LOCATION_ID || "").trim();
  if (!apiKey) throw new Error("Missing WHAUTOMATE_API_KEY");
  if (!base) throw new Error("Missing WHAUTOMATE_API_BASE");
  if (!locationId) throw new Error("Missing WHAUTOMATE_LOCATION_ID");
  return { apiKey, base, locationId };
}

function digitsOnlyPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * @param {{
 *   contactId?: string|null,
 *   phoneNumber?: string|null,
 *   name?: string|null,
 *   text: string,
 *   locationId?: string|null,
 * }} opts
 * @returns {Promise<{ ok: boolean, raw: any }>}
 */
export async function sendWhautomateText({
  contactId,
  phoneNumber,
  name,
  text,
  locationId: locationIdOverride,
}) {
  const bodyText = String(text || "").trim();
  if (!bodyText) {
    return { ok: false, raw: { error: "empty_text" } };
  }

  const { apiKey, base, locationId: envLocationId } = getApiConfig();
  const locationId = String(locationIdOverride || envLocationId || "").trim();
  if (!locationId) {
    return { ok: false, raw: { error: "missing_location_id" } };
  }

  const payload = {
    location: { id: locationId },
    textMessage: bodyText,
  };

  const id = String(contactId || "").trim();
  if (id) {
    payload.contact = { id };
  } else {
    const phone = digitsOnlyPhone(phoneNumber);
    if (!phone) {
      return { ok: false, raw: { error: "missing_contact_and_phone" } };
    }
    // name is optional in OpenAPI; include when present
    payload.recepient = { phoneNumber: phone };
    const displayName = String(name || "").trim();
    if (displayName) payload.recepient.name = displayName;
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
  const ok =
    response.ok &&
    (raw?.success === true || raw?.success === "true" || response.status < 300);
  if (!ok) {
    console.error(
      `[whautomate/send] failed status=${response.status} body=${JSON.stringify(raw).slice(0, 300)}`
    );
  }
  return { ok, raw };
}

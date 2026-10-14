const CHANNEL_MEDIUMS = new Set(["whatsapp"]);

function clean(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (CHANNEL_MEDIUMS.has(str.toLowerCase())) return null;
  return str;
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] || headers[name.toLowerCase()] || null;
}

function queryGet(searchParams, name) {
  if (!searchParams) return null;
  if (typeof searchParams.get === "function") return searchParams.get(name);
  return searchParams[name] || null;
}

/**
 * Account/location id for tenant mapping — not the WhatsApp *medium*
 * (`message.channel` = "whatsApp" in Whautomate's docs).
 *
 * Preferred: webhook URL `?channel=` (one URL per tenant) or
 * `x-whautomate-channel`. Also accepts a custom payload `location.id`
 * if Whautomate is later configured to send it.
 */
export function extractWhautomateChannelId(
  payload = {},
  { searchParams = null, headers = null } = {}
) {
  const fromQuery =
    queryGet(searchParams, "channel") ||
    queryGet(searchParams, "channel_id") ||
    queryGet(searchParams, "location_id") ||
    queryGet(searchParams, "location");
  const fromHeader =
    headerGet(headers, "x-whautomate-channel") ||
    headerGet(headers, "x-whautomate-location-id");
  const fromBody =
    payload?.location?.id ||
    payload?.locationId ||
    payload?.channel_id ||
    payload?.channelId ||
    payload?.message?.location?.id;

  return clean(fromQuery) || clean(fromHeader) || clean(fromBody) || null;
}

export async function resolveWhautomateTenant(supabase, channelId) {
  const id = clean(channelId);
  if (!supabase) {
    return { tenant: null, reason: "no_supabase" };
  }
  if (!id) {
    return { tenant: null, reason: "missing_channel" };
  }

  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, slug, whautomate_channel_id, autoreply_enabled, reply_prompt")
    .eq("whautomate_channel_id", id);

  if (error) {
    throw new Error(`Whautomate tenant lookup failed: ${error.message}`);
  }

  const rows = data || [];
  if (rows.length === 0) {
    return { tenant: null, reason: "unknown_channel" };
  }
  if (rows.length > 1) {
    return { tenant: null, reason: "ambiguous_channel" };
  }
  return { tenant: rows[0], reason: null };
}

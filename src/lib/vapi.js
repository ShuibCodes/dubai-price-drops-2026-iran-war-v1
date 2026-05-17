const VAPI_API_URL = "https://api.vapi.ai/call/phone";
const VAPI_LIST_CALLS_URL = "https://api.vapi.ai/call";

function normalizePhoneDigits(value) {
  return String(value ?? "").replace(/[^\d]/g, "");
}

function phoneEndingsMatch(a, b) {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 8 && longer.endsWith(shorter);
}

export async function getLatestCallByPhone(phone, { limit = 30 } = {}) {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VAPI_API_KEY");
  }
  const response = await fetch(`${VAPI_LIST_CALLS_URL}?limit=${limit}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Vapi call list failed (${response.status}): ${body?.message || "Unknown error"}`
    );
  }
  const calls = Array.isArray(body) ? body : body?.calls || body?.data || [];
  const matches = calls.filter((call) => {
    const candidate =
      call?.customer?.number || call?.to || call?.phoneNumber || "";
    return phoneEndingsMatch(candidate, phone);
  });
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const aTime = new Date(a?.endedAt || a?.startedAt || a?.createdAt || 0).getTime();
    const bTime = new Date(b?.endedAt || b?.startedAt || b?.createdAt || 0).getTime();
    return bTime - aTime;
  });
  const call = matches[0];
  return {
    callId: call?.id || call?.callId || null,
    status: call?.status || call?.state || "unknown",
    startedAt: call?.startedAt || call?.createdAt || null,
    endedAt: call?.endedAt || null,
    summary:
      call?.analysis?.summary ||
      call?.summary ||
      call?.analysis?.result ||
      "",
    transcript:
      call?.analysis?.transcript ||
      call?.transcript ||
      call?.recording?.transcript ||
      "",
    raw: call,
  };
}

export async function fireVapiCall({ listing, overridePhone }) {
  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

  if (!apiKey || !assistantId || !phoneNumberId) {
    throw new Error("Missing Vapi environment variables (VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID)");
  }

  const destinationNumber = overridePhone ?? listing.agentPhone;
  if (!destinationNumber) {
    throw new Error("No destination phone number available");
  }

  const priceFormatted = listing.price
    ? listing.price.toLocaleString("en-AE")
    : "price on request";

  const sqftFormatted = listing.sqft ? `${listing.sqft.toLocaleString()} sqft` : null;
  const bedsFormatted = listing.bedrooms != null ? `${listing.bedrooms} bed` : null;
  const sizeLabel = sqftFormatted ?? bedsFormatted ?? "size on request";

  const body = {
    assistantId,
    phoneNumberId,
    customer: {
      number: destinationNumber,
    },
    assistantOverrides: {
      variableValues: {
        listing_area: listing.area ?? listing.community ?? "Dubai",
        listing_address: listing.title ?? "the property",
        listing_price: priceFormatted,
        listing_type: listing.type ?? "property",
        listing_size: sizeLabel,
        agent_name: listing.agentName ?? "there",
        buyer_budget: "TBC",
      },
    },
  };

  const response = await fetch(VAPI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Vapi API returned non-JSON response (status ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(data?.message ?? data?.error ?? `Vapi API error ${response.status}`);
  }

  return data;
}

const VAPI_API_URL = "https://api.vapi.ai/call/phone";

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

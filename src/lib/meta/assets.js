const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";

// Embedded signup reports the WABA and phone number IDs to the browser via
// postMessage, which can be missed. The granted token itself carries the WABA it
// was issued for, so we can recover both IDs server-side.
export async function resolveWabaIdFromToken(businessToken) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!businessToken || !appId || !appSecret) return null;

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token`);
  url.searchParams.set("input_token", businessToken);
  url.searchParams.set("access_token", `${appId}|${appSecret}`);

  try {
    const response = await fetch(url.toString());
    const payload = await response.json();

    if (!response.ok) {
      console.error(
        "Meta debug_token failed:",
        payload?.error?.message || `status ${response.status}`
      );
      return null;
    }

    const scopes = payload?.data?.granular_scopes || [];
    const management = scopes.find((scope) =>
      ["whatsapp_business_management", "whatsapp_business_messaging"].includes(scope?.scope)
    );

    return management?.target_ids?.[0] || null;
  } catch (error) {
    console.error("Meta debug_token request failed:", error.message);
    return null;
  }
}

export async function resolvePhoneNumberIdFromWaba(wabaId, businessToken) {
  if (!wabaId || !businessToken) return null;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/phone_numbers?fields=id,display_phone_number`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${businessToken}` },
    });
    const payload = await response.json();

    if (!response.ok) {
      console.error(
        "Meta phone_numbers lookup failed:",
        payload?.error?.message || `status ${response.status}`
      );
      return null;
    }

    const numbers = Array.isArray(payload?.data) ? payload.data : [];
    // Only safe to infer when the WABA holds exactly one number.
    if (numbers.length !== 1) return null;

    return numbers[0]?.id || null;
  } catch (error) {
    console.error("Meta phone_numbers request failed:", error.message);
    return null;
  }
}

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";

// Meta only delivers webhooks for a customer WABA once the app is subscribed to
// it. Setting the callback URL in the App Dashboard is not enough.
export async function subscribeAppToWaba({ wabaId, businessToken }) {
  if (!wabaId || !businessToken) {
    return { subscribed: false, error: "Missing waba_id or business token" };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${businessToken}` },
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.success === false) {
      const message = payload?.error?.message || `Graph API error ${response.status}`;
      console.error("Meta subscribe_apps failed:", message);
      return { subscribed: false, error: message };
    }

    return { subscribed: true };
  } catch (error) {
    console.error("Meta subscribe_apps request failed:", error.message);
    return { subscribed: false, error: error.message };
  }
}

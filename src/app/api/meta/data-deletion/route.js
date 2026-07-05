import {
  createDeletionConfirmationCode,
  parseMetaSignedRequest,
} from "@/lib/meta/signed-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBaseUrl(request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, "");

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

async function handleDeletionRequest(metaUserId) {
  const confirmationCode = createDeletionConfirmationCode(metaUserId);

  // Log for manual/automated follow-up. Extend here to delete tenant rows by mapped Meta user id.
  console.info("Meta data deletion request received", {
    metaUserId: metaUserId || "unknown",
    confirmationCode,
  });

  return confirmationCode;
}

export async function POST(request) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return Response.json({ error: "Not configured" }, { status: 500 });
  }

  let signedRequest = null;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    signedRequest = form.get("signed_request");
  } else if (contentType.includes("application/json")) {
    const body = await request.json();
    signedRequest = body?.signed_request;
  } else {
    const text = await request.text();
    const params = new URLSearchParams(text);
    signedRequest = params.get("signed_request");
  }

  const payload = parseMetaSignedRequest(signedRequest, appSecret);
  if (!payload?.user_id) {
    return Response.json({ error: "Invalid signed request" }, { status: 400 });
  }

  const confirmationCode = await handleDeletionRequest(payload.user_id);
  const baseUrl = getBaseUrl(request);
  const statusUrl = `${baseUrl}/data-deletion?code=${encodeURIComponent(confirmationCode)}`;

  return Response.json({
    url: statusUrl,
    confirmation_code: confirmationCode,
  });
}

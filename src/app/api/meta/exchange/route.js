import { getSupabaseServerClient } from "@/lib/supabase/server";
import { subscribeAppToWaba } from "@/lib/meta/subscribe";
import {
  resolvePhoneNumberIdFromWaba,
  resolveWabaIdFromToken,
} from "@/lib/meta/assets";
import { resolveMetaExchangeTarget } from "@/lib/meta/exchange-tenant";
import { getSession } from "@/lib/copilot/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function resolveDisplayPhone(phoneNumberId, businessToken) {
  if (!phoneNumberId || !businessToken) return null;
  const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";
  try {
    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=display_phone_number`,
      { headers: { Authorization: `Bearer ${businessToken}` } }
    );
    const payload = await response.json();
    return payload?.display_phone_number || null;
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    let session = null;
    try {
      session = await getSession(request);
    } catch (error) {
      const forbidden = error.status === 403;
      return Response.json(
        {
          ok: false,
          error: forbidden
            ? "Forbidden for this tenant."
            : "Session lookup failed",
        },
        { status: forbidden ? 403 : 500 }
      );
    }

    const body = await request.json();
    const code = String(body?.code || "").trim();
    const wabaId = body?.waba_id ? String(body.waba_id).trim() : null;
    const phoneNumberId = body?.phone_number_id
      ? String(body.phone_number_id).trim()
      : null;
    const tenantSlug = body?.tenant_slug
      ? String(body.tenant_slug).trim().toLowerCase()
      : null;

    if (!code) {
      return Response.json({ ok: false, error: "Missing code" }, { status: 400 });
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";

    if (!appId || !appSecret) {
      return Response.json(
        { ok: false, error: "Meta app credentials not configured" },
        { status: 500 }
      );
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return Response.json(
        { ok: false, error: "Supabase not configured" },
        { status: 500 }
      );
    }

    // Resolve the destination before burning the single-use code.
    const target = await resolveMetaExchangeTarget({
      session,
      tenantSlug,
      supabase,
    });
    if (target.error) {
      return Response.json(
        { ok: false, error: target.error },
        { status: target.status || 400 }
      );
    }
    const targetTenantId = target.tenantId;

    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("code", code);

    const tokenResponse = await fetch(tokenUrl.toString(), { method: "GET" });
    const tokenPayload = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      console.error("Meta token exchange failed:", tokenPayload?.error?.message || "unknown");
      return Response.json({ ok: false, error: "Token exchange failed" }, { status: 502 });
    }

    const businessToken = tokenPayload.access_token;
    const resolvedWabaId = wabaId || (await resolveWabaIdFromToken(businessToken));
    const resolvedPhoneNumberId =
      phoneNumberId || (await resolvePhoneNumberIdFromWaba(resolvedWabaId, businessToken));

    const credentials = {
      business_token: businessToken,
    };

    if (resolvedWabaId) credentials.waba_id = resolvedWabaId;
    if (resolvedPhoneNumberId) credentials.phone_number_id = resolvedPhoneNumberId;
    const displayPhone = await resolveDisplayPhone(resolvedPhoneNumberId, businessToken);

    const { data: updated, error } = await supabase
      .from("tenants")
      .update(credentials)
      .eq("id", targetTenantId)
      .select("id");

    if (error) {
      console.error("Meta token exchange tenant update failed:", error.message);
      return Response.json({ ok: false, error: "Failed to store token" }, { status: 500 });
    }

    if (!updated?.length) {
      console.error("Meta token exchange matched no tenant row:", targetTenantId);
      return Response.json(
        { ok: false, error: "Token not stored: no matching tenant" },
        { status: 500 }
      );
    }
    if (displayPhone) {
      await supabase
        .from("tenants")
        .update({ display_phone: displayPhone })
        .eq("id", targetTenantId);
    }

    const subscription = await subscribeAppToWaba({
      wabaId: resolvedWabaId,
      businessToken,
    });

    return Response.json({
      ok: true,
      tenant_id: targetTenantId,
      waba_id: resolvedWabaId,
      phone_number_id: resolvedPhoneNumberId,
      subscribed: subscription.subscribed,
      subscribe_error: subscription.error || null,
    });
  } catch (error) {
    console.error("Meta exchange route error:", error.message);
    return Response.json({ ok: false, error: "Unexpected error" }, { status: 500 });
  }
}

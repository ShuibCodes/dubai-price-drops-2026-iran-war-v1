import { getSupabaseServerClient } from "@/lib/supabase/server";
import { subscribeAppToWaba } from "@/lib/meta/subscribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Picks the tenant row that should own these Meta credentials. An explicit slug
// wins; otherwise we match a tenant already holding this WABA, and finally fall
// back to the oldest tenant (single-tenant installs).
async function resolveTargetTenantId(supabase, { tenantSlug, wabaId }) {
  if (tenantSlug) {
    const { data } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .maybeSingle();

    return { id: data?.id || null, missingSlug: !data?.id };
  }

  if (wabaId) {
    const { data } = await supabase
      .from("tenants")
      .select("id")
      .eq("waba_id", wabaId)
      .maybeSingle();

    if (data?.id) return { id: data.id, missingSlug: false };
  }

  const { data: firstTenant } = await supabase
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return { id: firstTenant?.id || null, missingSlug: false };
}

export async function POST(request) {
  try {
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

    // Resolve the destination before burning the single-use code, so a bad slug
    // does not cost the caller a fresh trip through embedded signup.
    const { id: targetTenantId, missingSlug } = await resolveTargetTenantId(supabase, {
      tenantSlug,
      wabaId,
    });

    if (missingSlug) {
      return Response.json(
        { ok: false, error: `No tenant with slug "${tenantSlug}"` },
        { status: 400 }
      );
    }

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

    const credentials = {
      business_token: tokenPayload.access_token,
    };

    if (wabaId) credentials.waba_id = wabaId;
    if (phoneNumberId) credentials.phone_number_id = phoneNumberId;

    let storedTenantId = targetTenantId;

    if (targetTenantId) {
      const { data: updated, error } = await supabase
        .from("tenants")
        .update(credentials)
        .eq("id", targetTenantId)
        .select("id");

      if (error) {
        console.error("Meta token exchange tenant update failed:", error.message);
        return Response.json({ ok: false, error: "Failed to store token" }, { status: 500 });
      }

      // A zero-row update is silent in Postgres — treat it as a hard failure so
      // the UI never reports success on a token that went nowhere.
      if (!updated?.length) {
        console.error("Meta token exchange matched no tenant row:", targetTenantId);
        return Response.json(
          { ok: false, error: "Token not stored: no matching tenant" },
          { status: 500 }
        );
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("tenants")
        .insert({ name: "Default Tenant", ...credentials })
        .select("id")
        .single();

      if (insertError) {
        console.error("Meta token exchange tenant insert failed:", insertError.message);
        return Response.json({ ok: false, error: "Failed to store token" }, { status: 500 });
      }

      storedTenantId = inserted.id;
    }

    const subscription = await subscribeAppToWaba({
      wabaId,
      businessToken: tokenPayload.access_token,
    });

    return Response.json({
      ok: true,
      tenant_id: storedTenantId,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      subscribed: subscription.subscribed,
      subscribe_error: subscription.error || null,
    });
  } catch (error) {
    console.error("Meta exchange route error:", error.message);
    return Response.json({ ok: false, error: "Unexpected error" }, { status: 500 });
  }
}

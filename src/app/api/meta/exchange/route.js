import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const code = String(body?.code || "").trim();
    const wabaId = body?.waba_id ? String(body.waba_id).trim() : null;
    const phoneNumberId = body?.phone_number_id
      ? String(body.phone_number_id).trim()
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

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return Response.json(
        { ok: false, error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const updatePayload = {
      business_token: tokenPayload.access_token,
    };

    if (wabaId) updatePayload.waba_id = wabaId;
    if (phoneNumberId) updatePayload.phone_number_id = phoneNumberId;

    let updateQuery = supabase.from("tenants").update(updatePayload);

    if (wabaId) {
      updateQuery = updateQuery.eq("waba_id", wabaId);
    } else {
      const { data: firstTenant } = await supabase
        .from("tenants")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!firstTenant?.id) {
        const { error: insertError } = await supabase.from("tenants").insert({
          name: "Default Tenant",
          ...updatePayload,
        });

        if (insertError) {
          console.error("Meta token exchange tenant insert failed:", insertError.message);
          return Response.json({ ok: false, error: "Failed to store token" }, { status: 500 });
        }

        return Response.json({ ok: true });
      }

      updateQuery = updateQuery.eq("id", firstTenant.id);
    }

    const { error } = await updateQuery;

    if (error) {
      console.error("Meta token exchange tenant update failed:", error.message);
      return Response.json({ ok: false, error: "Failed to store token" }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Meta exchange route error:", error.message);
    return Response.json({ ok: false, error: "Unexpected error" }, { status: 500 });
  }
}

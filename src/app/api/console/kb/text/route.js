import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const [tenantRes, sourcesRes] = await Promise.all([
      supabase
        .from("tenants")
        .select("kb_text")
        .eq("id", session.tenantId)
        .maybeSingle()
        .catch(() => ({ data: null })),
      supabase
        .from("tenant_kb_sources")
        .select("id, source_type, source_url, status, pages_crawled, created_at, updated_at")
        .eq("tenant_id", session.tenantId)
        .order("created_at", { ascending: false })
        .limit(10)
        .catch(() => ({ data: [] })),
    ]);

    const kbText = String(tenantRes?.data?.kb_text || "");
    const wordCount = kbText ? kbText.split(/\s+/).filter(Boolean).length : 0;

    return Response.json({
      kbText,
      wordCount,
      charCount: kbText.length,
      sources: sourcesRes?.data || [],
    });
  } catch (error) {
    return jsonError(error.message || "Failed to load knowledge text", error.status || 500);
  }
}

export async function PATCH(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const body = await request.json().catch(() => ({}));
    const kbText = String(body?.kbText ?? "").trim();

    const { error } = await supabase
      .from("tenants")
      .update({ kb_text: kbText })
      .eq("id", session.tenantId);

    if (error) {
      if (/column.*kb_text.*does not exist/i.test(error.message)) {
        return jsonError(
          "Database migration pending: column tenants.kb_text does not exist. Please apply 039_tenant_website_kb.sql.",
          500
        );
      }
      throw new Error(`Failed to update knowledge text: ${error.message}`);
    }

    const wordCount = kbText ? kbText.split(/\s+/).filter(Boolean).length : 0;

    return Response.json({
      ok: true,
      kbText,
      wordCount,
      charCount: kbText.length,
    });
  } catch (error) {
    return jsonError(error.message || "Failed to update knowledge text", error.status || 500);
  }
}


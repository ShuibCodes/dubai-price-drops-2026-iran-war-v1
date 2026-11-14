import { consoleContext, jsonError } from "@/lib/console/http";
import { executeCrawlPipeline, getMemoryJob, setMemoryJob } from "@/lib/kb/pipeline";
import { normalizeUrl } from "@/lib/kb/crawler";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const body = await request.json().catch(() => ({}));
    const rawUrl = String(body?.url || "").trim();
    const isSubUrl = Boolean(body?.isSubUrl);

    if (!rawUrl) {
      return jsonError("Website URL is required.", 400);
    }

    const normalized = normalizeUrl(rawUrl);
    if (!normalized) {
      return jsonError("Please enter a valid website URL (e.g. https://stageproperties.com).", 400);
    }

    // Load tenant name and current kb_text
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, kb_text")
      .eq("id", session.tenantId)
      .maybeSingle();

    const sourceId = randomUUID();

    // Create DB tracking row if table exists
    const initialRow = {
      id: sourceId,
      tenant_id: session.tenantId,
      source_type: isSubUrl ? "sub_url" : "website",
      source_url: normalized,
      status: "crawling",
      current_step: "Initializing crawler...",
      pages_found: 1,
      pages_crawled: 0,
      progress_percent: 5,
    };

    setMemoryJob(sourceId, initialRow);

    await supabase
      .from("tenant_kb_sources")
      .insert(initialRow)
      .catch(() => {});

    // Execute pipeline in background (unawaited)
    executeCrawlPipeline({
      supabase,
      tenantId: session.tenantId,
      sourceId,
      url: normalized,
      isSubUrl,
      tenantName: tenant?.name || "",
      existingKb: tenant?.kb_text || "",
    }).catch((err) => {
      console.error("Async crawl uncaught error:", err);
    });

    return Response.json({
      ok: true,
      sourceId,
      status: "crawling",
      url: normalized,
    });
  } catch (error) {
    return jsonError(error.message || "Failed to start crawler", error.status || 500);
  }
}

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId");

    let source = null;

    if (sourceId) {
      const { data } = await supabase
        .from("tenant_kb_sources")
        .select("*")
        .eq("id", sourceId)
        .eq("tenant_id", session.tenantId)
        .maybeSingle()
        .catch(() => ({ data: null }));

      source = data || getMemoryJob(sourceId);
    } else {
      // Get the latest crawl source for this tenant
      const { data } = await supabase
        .from("tenant_kb_sources")
        .select("*")
        .eq("tenant_id", session.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .catch(() => ({ data: null }));

      source = data;
    }

    // Also get current tenant kb_text
    const { data: tenant } = await supabase
      .from("tenants")
      .select("kb_text")
      .eq("id", session.tenantId)
      .maybeSingle()
      .catch(() => ({ data: null }));

    return Response.json({
      source: source || null,
      kbText: tenant?.kb_text || "",
    });
  } catch (error) {
    return jsonError(error.message || "Failed to get crawl status", error.status || 500);
  }
}


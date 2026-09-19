import { consoleContext, jsonError } from "@/lib/console/http";
import { routeId } from "@/lib/scripts/http";
import { FeedbackError } from "@/lib/feedback/access";
import { loadTenantAttachment } from "@/lib/feedback/store";
import { downloadFeedbackImage } from "@/lib/feedback/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const id = await routeId(params);
    const attachment = await loadTenantAttachment(
      ctx.supabase,
      ctx.session.tenantId,
      id
    );
    const blob = await downloadFeedbackImage(
      ctx.supabase,
      attachment.storage_path
    );
    const buffer = Buffer.from(await blob.arrayBuffer());
    return new Response(buffer, {
      headers: {
        "Content-Type": attachment.content_type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${attachment.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const status = error instanceof FeedbackError ? error.status : error.status || 500;
    return jsonError(error.message || "Unexpected error", status);
  }
}

import { consoleContext, jsonError } from "@/lib/console/http";
import { routeId } from "@/lib/scripts/http";
import { FeedbackError } from "@/lib/feedback/access";
import {
  addTicketAttachment,
  loadTenantTicket,
  publicAttachment,
} from "@/lib/feedback/store";
import {
  attachmentStoragePath,
  uploadFeedbackImage,
  validateImageFile,
} from "@/lib/feedback/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const id = await routeId(params);
    const ticket = await loadTenantTicket(
      ctx.supabase,
      ctx.session.tenantId,
      id
    );

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return jsonError("file is required.", 400);
    }

    const meta = validateImageFile({
      filename: file.name,
      contentType: file.type,
      bytes: file.size,
    });
    const attachmentId = crypto.randomUUID();
    const storagePath = attachmentStoragePath({
      tenantId: ctx.session.tenantId,
      agentId: ctx.session.agentId,
      id: attachmentId,
      filename: meta.filename,
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadFeedbackImage(ctx.supabase, {
      storagePath,
      buffer,
      contentType: meta.contentType,
    });

    const attachment = await addTicketAttachment(ctx.supabase, {
      id: attachmentId,
      tenant_id: ctx.session.tenantId,
      ticket_id: ticket.id,
      filename: meta.filename,
      storage_path: storagePath,
      bytes: meta.bytes,
      content_type: meta.contentType,
      uploaded_by_agent_id: ctx.session.agentId,
    });
    return Response.json(
      { attachment: publicAttachment(attachment) },
      { status: 201 }
    );
  } catch (error) {
    const status = error instanceof FeedbackError ? error.status : error.status || 500;
    return jsonError(error.message || "Unexpected error", status);
  }
}

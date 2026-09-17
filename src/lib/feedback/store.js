import { FeedbackError, notFoundTicket, requireTenantId, ticketBelongsToTenant } from "@/lib/feedback/access";
import {
  FEEDBACK_PRIORITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  isFeedbackPriority,
  isFeedbackStatus,
  isFeedbackType,
} from "@/lib/feedback/constants";

const TICKET_COLS =
  "id, tenant_id, created_by_agent_id, type, title, description, status, priority, assigned_to, created_at, updated_at";

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function touchUpdatedAt() {
  return new Date().toISOString();
}

export function publicTicket(row, { staff = false } = {}) {
  if (!row) return null;
  const base = {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_agent_id: row.created_by_agent_id || null,
  };
  if (!staff) return base;
  return {
    ...base,
    tenant_id: row.tenant_id,
    priority: row.priority,
    assigned_to: row.assigned_to || null,
  };
}

export function publicComment(row) {
  return {
    id: row.id,
    author_kind: row.author_kind,
    body: row.body,
    created_at: row.created_at,
  };
}

export function publicAttachment(row) {
  return {
    id: row.id,
    filename: row.filename,
    bytes: row.bytes,
    content_type: row.content_type,
    created_at: row.created_at,
  };
}

export async function listTenantTickets(supabase, tenantId) {
  const scoped = requireTenantId(tenantId);
  const { data, error } = await supabase
    .from("feedback_tickets")
    .select(TICKET_COLS)
    .eq("tenant_id", scoped)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Feedback list failed: ${error.message}`);
  return (data || []).map((row) => publicTicket(row));
}

export async function listStaffTickets(supabase, { tenantId, type, status } = {}) {
  let query = supabase
    .from("feedback_tickets")
    .select(`${TICKET_COLS}, tenants(slug, name)`)
    .order("updated_at", { ascending: false });
  if (tenantId) query = query.eq("tenant_id", String(tenantId).trim());
  if (type && isFeedbackType(type)) query = query.eq("type", type);
  if (status && isFeedbackStatus(status)) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`Feedback list failed: ${error.message}`);
  return (data || []).map((row) => ({
    ...publicTicket(row, { staff: true }),
    tenant_slug: row.tenants?.slug || null,
    tenant_name: row.tenants?.name || null,
  }));
}

export async function loadTenantTicket(supabase, tenantId, id) {
  const scoped = requireTenantId(tenantId);
  const ticketId = String(id || "").trim();
  if (!ticketId) throw notFoundTicket();
  const { data, error } = await supabase
    .from("feedback_tickets")
    .select(TICKET_COLS)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new Error(`Feedback lookup failed: ${error.message}`);
  if (!ticketBelongsToTenant(data, scoped)) throw notFoundTicket();
  return data;
}

export async function loadStaffTicket(supabase, id) {
  const ticketId = String(id || "").trim();
  if (!ticketId) throw notFoundTicket();
  const { data, error } = await supabase
    .from("feedback_tickets")
    .select(`${TICKET_COLS}, tenants(slug, name)`)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new Error(`Feedback lookup failed: ${error.message}`);
  if (!data) throw notFoundTicket();
  return data;
}

export async function createTenantTicket(supabase, session, input) {
  const tenantId = requireTenantId(session.tenantId);
  const type = String(input?.type || "");
  if (!isFeedbackType(type)) {
    throw new FeedbackError(
      `Type must be one of: ${FEEDBACK_TYPES.join(", ")}.`,
      400
    );
  }
  const title = cleanText(input?.title);
  if (!title) throw new FeedbackError("Title is required.", 400);
  const description = cleanText(input?.description);
  if (!description) throw new FeedbackError("Description is required.", 400);

  const { data, error } = await supabase
    .from("feedback_tickets")
    .insert({
      tenant_id: tenantId,
      created_by_agent_id: session.agentId,
      type,
      title: title.slice(0, 200),
      description: description.slice(0, 8000),
      status: "new",
      priority: "normal",
    })
    .select(TICKET_COLS)
    .single();
  if (error) throw new Error(`Feedback create failed: ${error.message}`);
  return data;
}

export async function listTicketComments(supabase, tenantId, ticketId) {
  const scoped = requireTenantId(tenantId);
  const { data, error } = await supabase
    .from("feedback_comments")
    .select("id, tenant_id, ticket_id, author_kind, body, created_at")
    .eq("tenant_id", scoped)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Feedback comments failed: ${error.message}`);
  return data || [];
}

export async function listTicketAttachments(supabase, tenantId, ticketId) {
  const scoped = requireTenantId(tenantId);
  const { data, error } = await supabase
    .from("feedback_attachments")
    .select(
      "id, tenant_id, ticket_id, filename, storage_path, bytes, content_type, created_at"
    )
    .eq("tenant_id", scoped)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Feedback attachments failed: ${error.message}`);
  return data || [];
}

export async function addTicketComment(
  supabase,
  { tenantId, ticketId, authorKind, authorAgentId, body }
) {
  const ticket = await loadTenantTicket(supabase, tenantId, ticketId);
  const text = cleanText(body);
  if (!text) throw new FeedbackError("Comment is required.", 400);
  if (authorKind !== "client" && authorKind !== "staff") {
    throw new FeedbackError("Invalid comment author.", 400);
  }
  const { data, error } = await supabase
    .from("feedback_comments")
    .insert({
      tenant_id: ticket.tenant_id,
      ticket_id: ticket.id,
      author_kind: authorKind,
      author_agent_id: authorKind === "client" ? authorAgentId || null : null,
      body: text.slice(0, 8000),
    })
    .select("id, tenant_id, ticket_id, author_kind, body, created_at")
    .single();
  if (error) throw new Error(`Feedback comment failed: ${error.message}`);
  await supabase
    .from("feedback_tickets")
    .update({ updated_at: touchUpdatedAt() })
    .eq("id", ticketId)
    .eq("tenant_id", tenantId);
  return data;
}

export async function addTicketAttachment(supabase, row) {
  const { data, error } = await supabase
    .from("feedback_attachments")
    .insert(row)
    .select(
      "id, tenant_id, ticket_id, filename, storage_path, bytes, content_type, created_at"
    )
    .single();
  if (error) throw new Error(`Feedback attachment failed: ${error.message}`);
  await supabase
    .from("feedback_tickets")
    .update({ updated_at: touchUpdatedAt() })
    .eq("id", row.ticket_id)
    .eq("tenant_id", row.tenant_id);
  return data;
}

export async function loadTenantAttachment(supabase, tenantId, id) {
  const scoped = requireTenantId(tenantId);
  const attachmentId = String(id || "").trim();
  if (!attachmentId) throw new FeedbackError("Attachment not found.", 404);
  const { data, error } = await supabase
    .from("feedback_attachments")
    .select(
      "id, tenant_id, ticket_id, filename, storage_path, bytes, content_type"
    )
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw new Error(`Attachment lookup failed: ${error.message}`);
  if (!data || String(data.tenant_id) !== scoped) {
    throw new FeedbackError("Attachment not found.", 404);
  }
  return data;
}

export async function loadStaffAttachment(supabase, id) {
  const attachmentId = String(id || "").trim();
  if (!attachmentId) throw new FeedbackError("Attachment not found.", 404);
  const { data, error } = await supabase
    .from("feedback_attachments")
    .select(
      "id, tenant_id, ticket_id, filename, storage_path, bytes, content_type"
    )
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw new Error(`Attachment lookup failed: ${error.message}`);
  if (!data) throw new FeedbackError("Attachment not found.", 404);
  return data;
}

export function staffTicketPatch(input) {
  const patch = {};
  if (input?.status !== undefined) {
    if (!isFeedbackStatus(input.status)) {
      throw new FeedbackError(
        `Status must be one of: ${FEEDBACK_STATUSES.join(", ")}.`,
        400
      );
    }
    patch.status = input.status;
  }
  if (input?.priority !== undefined) {
    if (!isFeedbackPriority(input.priority)) {
      throw new FeedbackError(
        `Priority must be one of: ${FEEDBACK_PRIORITIES.join(", ")}.`,
        400
      );
    }
    patch.priority = input.priority;
  }
  if (input?.assigned_to !== undefined) {
    const name = cleanText(input.assigned_to);
    patch.assigned_to = name ? name.slice(0, 120) : null;
  }
  if (!Object.keys(patch).length) {
    throw new FeedbackError("Nothing to update.", 400);
  }
  patch.updated_at = touchUpdatedAt();
  return patch;
}

export async function updateStaffTicket(supabase, id, input) {
  const existing = await loadStaffTicket(supabase, id);
  const patch = staffTicketPatch(input);
  const { data, error } = await supabase
    .from("feedback_tickets")
    .update(patch)
    .eq("id", existing.id)
    .select(`${TICKET_COLS}, tenants(slug, name)`)
    .single();
  if (error) throw new Error(`Feedback update failed: ${error.message}`);
  return data;
}

export function rejectClientStaffFields(body) {
  if (
    body &&
    (body.status !== undefined ||
      body.priority !== undefined ||
      body.assigned_to !== undefined ||
      body.tenant_id !== undefined)
  ) {
    throw new FeedbackError("Cannot set staff-only fields.", 400);
  }
}

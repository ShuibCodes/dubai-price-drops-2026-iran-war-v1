export class FeedbackError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function notFoundTicket() {
  return new FeedbackError("Ticket not found.", 404);
}

export function requireTenantId(tenantId) {
  const id = String(tenantId || "").trim();
  if (!id) throw new FeedbackError("Tenant is required.", 400);
  return id;
}

export function ticketBelongsToTenant(row, tenantId) {
  return Boolean(row?.id) && String(row.tenant_id) === String(tenantId);
}

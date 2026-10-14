export function actionsCallGuard(session) {
  if (!session?.agentId || !session?.tenantId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (session.role !== "admin") {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true };
}

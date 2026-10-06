import { fetchReceivedEmail, verifyResendWebhookSignature } from "@/lib/email/resend-receiving";
import { resolveTenantFromRecipients } from "@/lib/dubizzle/tenant-by-inbound-email";
import { normalizeInboundAddress } from "@/lib/dubizzle/inbound-email";

function fromAddress(data = {}) {
  return normalizeInboundAddress(data.from) || "unknown";
}

function isUniqueViolation(error) {
  return error?.code === "23505" || /duplicate key|unique/i.test(String(error?.message || ""));
}

async function attachInboundRawText({
  supabase,
  leadId,
  tenantId,
  emailId,
  fetchBody = fetchReceivedEmail,
}) {
  try {
    const rawText = await fetchBody(emailId);
    if (!rawText) return;
    const { error } = await supabase
      .from("inbound_leads")
      .update({ raw_text: rawText })
      .eq("id", leadId)
      .eq("tenant_id", tenantId);
    if (error) {
      console.error("[dubizzle] raw_text update failed");
    }
  } catch (error) {
    console.error("[dubizzle] raw_text attach failed", error?.message);
  }
}

/**
 * Resend inbound webhook. Inserts `inbound_leads` with status=received only.
 * Does not parse enquiries, write CRM leads, or place outbound calls.
 */
export async function handleDubizzleInbound({
  rawBody,
  headers,
  supabase,
  waitUntil,
  fetchBody = fetchReceivedEmail,
  webhookSecret = process.env.RESEND_WEBHOOK_SECRET,
} = {}) {
  if (!verifyResendWebhookSignature({ rawBody, headers, secret: webhookSecret })) {
    return { status: 401, body: { ok: false, error: "Unauthorized" } };
  }

  let payload;
  try {
    payload = JSON.parse(String(rawBody || ""));
  } catch {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  if (payload?.type !== "email.received") {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const data = payload.data || {};
  const resendEmailId = String(data.email_id || "").trim();
  if (!resendEmailId) {
    console.info("[dubizzle] email.received missing email_id");
    return { status: 200, body: { ok: true, ignored: true } };
  }

  if (!supabase) {
    console.error("[dubizzle] supabase not configured");
    return { status: 200, body: { ok: true, ignored: true } };
  }

  let resolved;
  try {
    resolved = await resolveTenantFromRecipients(supabase, data);
  } catch (error) {
    console.error("[dubizzle] tenant lookup failed", error?.message);
    return { status: 200, body: { ok: true, ignored: true } };
  }

  if (resolved.retired) {
    console.info("[dubizzle] retired recipient ignored");
    return { status: 200, body: { ok: true, ignored: true } };
  }

  if (!resolved.tenant?.id) {
    console.info("[dubizzle] unknown recipient");
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const row = {
    tenant_id: resolved.tenant.id,
    resend_email_id: resendEmailId,
    from_address: fromAddress(data),
    subject: data.subject ? String(data.subject).slice(0, 500) : null,
    raw_text: null,
    status: "received",
  };

  const inserted = await supabase
    .from("inbound_leads")
    .insert(row)
    .select("id, tenant_id, resend_email_id, status")
    .maybeSingle();

  if (inserted.error) {
    if (isUniqueViolation(inserted.error)) {
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    console.error("[dubizzle] inbound_leads insert failed");
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const leadId = inserted.data?.id;
  if (leadId) {
    const pending = attachInboundRawText({
      supabase,
      leadId,
      tenantId: resolved.tenant.id,
      emailId: resendEmailId,
      fetchBody,
    });
    if (typeof waitUntil === "function") {
      waitUntil(pending);
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      tenant: resolved.tenant.slug,
      leadId: leadId || null,
    },
  };
}

const RESEND_API_URL = "https://api.resend.com/emails";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function ensureCleanEmailBody(body) {
  const normalized = String(body ?? "")
    .replace(/—/g, "-")
    .replace(/\r/g, "")
    .trim();
  return normalized;
}

export async function sendLeadEmail({ to, subject, text, metadata: _metadata = {} }) {
  const apiKey = getRequiredEnv("RESEND_API_KEY");
  const from = getRequiredEnv("RESEND_FROM_EMAIL");

  if (!to || !subject || !text) {
    throw new Error("Missing required email payload fields");
  }

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject: String(subject).trim(),
    text: ensureCleanEmailBody(text),
    // Keep payload minimal for reliability across Resend accounts.
    // Metadata is accepted by this function for internal tracing, but is not sent as tags.
  };

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Resend returned non-JSON response (${response.status})`);
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Resend error (${response.status})`;
    throw new Error(message);
  }

  return data;
}

const RESEND_TEMPLATES_URL = "https://api.resend.com/templates";
const RESEND_BROADCASTS_URL = "https://api.resend.com/broadcasts";
const DEFAULT_LEAD_MAGNET_SUBJECT = "Your free AgentZero one-pager tool access";

function splitName(fullName) {
  const cleanName = String(fullName ?? "").trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "there";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return { fullName: cleanName || "there", firstName, lastName };
}

function interpolatePlaceholders(content, { fullName, firstName, lastName, email }) {
  if (!content) return content;
  const map = {
    name: fullName,
    full_name: fullName,
    fullname: fullName,
    user_name: fullName,
    username: fullName,
    lead_name: fullName,
    broker_name: fullName,
    first_name: firstName,
    firstname: firstName,
    last_name: lastName,
    lastname: lastName,
    email,
    user_email: email,
    lead_email: email,
    broker_email: email,
    email_address: email,
  };

  // Supports {{{VAR|fallback}}}, {{{VAR}}}, and {{VAR}}
  return String(content).replace(
    /\{\{\{?\s*([a-zA-Z0-9_]+)(?:\|([^}]*))?\s*\}?\}\}/g,
    (match, rawKey, fallback) => {
      const normalizedKey = String(rawKey || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(map, normalizedKey)) {
        const val = map[normalizedKey];
        return val || fallback || "";
      }
      return fallback !== undefined ? fallback : match;
    }
  );
}

function buildTemplateVariables(templateVars, { fullName, firstName, lastName, email }) {
  const base = {
    NAME: fullName,
    name: fullName,
    FULL_NAME: fullName,
    full_name: fullName,
    USER_NAME: fullName,
    user_name: fullName,
    FIRSTNAME: firstName,
    first_name: firstName,
    LASTNAME: lastName,
    last_name: lastName,
    USER_EMAIL: email,
    user_email: email,
    EMAIL_ADDRESS: email,
    email_address: email,
  };

  if (!Array.isArray(templateVars) || templateVars.length === 0) {
    return base;
  }

  const variables = {};
  for (const item of templateVars) {
    const key = item?.key;
    if (!key) continue;
    const lower = key.toLowerCase();
    if (lower.includes("email") || lower.includes("mail")) {
      variables[key] = email;
    } else if (lower.includes("first")) {
      variables[key] = firstName;
    } else if (lower.includes("last")) {
      variables[key] = lastName || firstName;
    } else if (lower.includes("name") || lower.includes("user") || lower.includes("broker") || lower.includes("lead")) {
      variables[key] = fullName;
    } else if (item?.fallback_value !== undefined && item?.fallback_value !== null) {
      variables[key] = item.fallback_value;
    } else {
      variables[key] = fullName;
    }
  }
  return variables;
}

async function fetchResendJson(url, apiKey, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

async function resolveResendTemplate(apiKey) {
  const configuredId =
    process.env.RESEND_LEAD_MAGNET_TEMPLATE_ID?.trim() ||
    process.env.RESEND_TEMPLATE_ID?.trim();

  if (configuredId) {
    const { ok, data } = await fetchResendJson(
      `${RESEND_TEMPLATES_URL}/${encodeURIComponent(configuredId)}`,
      apiKey
    );
    if (ok && data?.id) return data;
    // Still return minimal reference in case it's an alias or template fetch isn't permitted
    return { id: configuredId, status: "published" };
  }

  const listResp = await fetchResendJson(RESEND_TEMPLATES_URL, apiKey);
  const templates = Array.isArray(listResp.data?.data) ? listResp.data.data : [];
  if (templates.length === 0) return null;

  const preferred =
    templates.find((t) =>
      /lead|magnet|one[-_ ]?pager|popup|agentzero|access/i.test(
        `${t.name || ""} ${t.alias || ""}`
      )
    ) || templates[0];

  if (!preferred?.id) return null;

  const detailResp = await fetchResendJson(
    `${RESEND_TEMPLATES_URL}/${encodeURIComponent(preferred.id)}`,
    apiKey
  );
  return detailResp.ok && detailResp.data?.id ? detailResp.data : preferred;
}

async function resolveRecentBroadcastTemplate(apiKey) {
  const configuredBroadcastId =
    process.env.RESEND_LEAD_MAGNET_BROADCAST_ID?.trim() ||
    process.env.RESEND_BROADCAST_ID?.trim();

  if (configuredBroadcastId) {
    const { ok, data } = await fetchResendJson(
      `${RESEND_BROADCASTS_URL}/${encodeURIComponent(configuredBroadcastId)}`,
      apiKey
    );
    if (ok && data?.id && (data.html || data.text)) return data;
  }

  const listResp = await fetchResendJson(RESEND_BROADCASTS_URL, apiKey);
  const broadcasts = Array.isArray(listResp.data?.data) ? listResp.data.data : [];
  const candidate = broadcasts.find((b) =>
    /lead|magnet|one[-_ ]?pager|popup|agentzero/i.test(String(b.name || ""))
  );
  if (!candidate?.id) return null;

  const detailResp = await fetchResendJson(
    `${RESEND_BROADCASTS_URL}/${encodeURIComponent(candidate.id)}`,
    apiKey
  );
  if (detailResp.ok && detailResp.data && (detailResp.data.html || detailResp.data.text)) {
    return detailResp.data;
  }
  return null;
}

function buildFallbackLeadMagnetEmail({ fullName, firstName, email }) {
  const subject =
    process.env.RESEND_LEAD_MAGNET_SUBJECT?.trim() || DEFAULT_LEAD_MAGNET_SUBJECT;
  const html = `
    <div style="font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #0c0c0c; color: #ffffff; border-radius: 16px; border: 1px solid #262626;">
      <p style="font-family: monospace; font-size: 11px; letter-spacing: 0.18em; color: #6fd38f; margin: 0 0 12px;">AGENTZERO · FREE TOOL</p>
      <h1 style="font-size: 24px; line-height: 1.25; margin: 0 0 16px; color: #ffffff;">Hi ${firstName}, your One-Pager access is ready</h1>
      <p style="font-size: 15px; line-height: 1.6; color: #bdbdbd; margin: 0 0 20px;">
        Thanks for requesting access to the AgentZero branded property one-pager tool with <strong>${email}</strong>.
      </p>
      <p style="font-size: 15px; line-height: 1.6; color: #bdbdbd; margin: 0 0 24px;">
        Paste any listing link and let AI turn it into a clean, branded one-pager PDF you can send straight to buyers on WhatsApp.
      </p>
      <a href="https://agentzero.ae/ai-proposal-generator" style="display: inline-block; background: #6fd38f; color: #000000; font-weight: 600; font-size: 15px; padding: 14px 24px; border-radius: 10px; text-decoration: none;">
        Open the one-pager tool
      </a>
      <p style="font-size: 12px; color: #7a7a7a; margin: 28px 0 0;">
        Requested by ${fullName} (${email})
      </p>
    </div>
  `.trim();

  const text = [
    `Hi ${firstName},`,
    "",
    `Thanks for requesting access to the AgentZero branded property one-pager tool (${email}).`,
    "",
    "Paste any listing link and let AI turn it into a clean, branded one-pager PDF you can send straight to buyers on WhatsApp.",
    "",
    "Open the tool: https://agentzero.ae/ai-proposal-generator",
  ].join("\n");

  return { subject, html, text };
}

export async function sendLeadMagnetEmail({ name, email }) {
  const apiKey = getRequiredEnv("RESEND_API_KEY");
  const defaultFrom = getRequiredEnv("RESEND_FROM_EMAIL");
  const recipient = String(email ?? "").trim().toLowerCase();
  const person = splitName(name);

  if (!recipient) {
    throw new Error("Missing recipient email");
  }

  // Optional: sync contact into Resend Audience if RESEND_AUDIENCE_ID is set
  const audienceId = process.env.RESEND_AUDIENCE_ID?.trim();
  if (audienceId) {
    fetchResendJson(
      `https://api.resend.com/audiences/${encodeURIComponent(audienceId)}/contacts`,
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          email: recipient,
          first_name: person.firstName,
          last_name: person.lastName || undefined,
          unsubscribed: false,
        }),
      }
    ).catch(() => {});
  }

  // 1. Check Resend Templates first
  const template = await resolveResendTemplate(apiKey);
  if (template) {
    const variables = buildTemplateVariables(template.variables, {
      ...person,
      email: recipient,
    });
    const from = template.from || defaultFrom;
    const subject = interpolatePlaceholders(
      template.subject ||
        process.env.RESEND_LEAD_MAGNET_SUBJECT?.trim() ||
        DEFAULT_LEAD_MAGNET_SUBJECT,
      { ...person, email: recipient }
    );

    if (template.status === "published" || !template.html) {
      const sendResp = await fetchResendJson(RESEND_API_URL, apiKey, {
        method: "POST",
        body: JSON.stringify({
          from,
          to: [recipient],
          subject,
          ...(template.reply_to ? { reply_to: template.reply_to } : {}),
          template: {
            id: template.id,
            variables,
          },
        }),
      });

      if (sendResp.ok) {
        return {
          id: sendResp.data?.id ?? null,
          templateId: template.id,
          mode: "resend_template",
        };
      }
    }

    // If the template in Resend is still in draft (unpublished) or template send returned a validation error,
    // render its HTML/text directly with the persisted name & email variables.
    if (template.html || template.text) {
      const renderedHtml = interpolatePlaceholders(template.html, {
        ...person,
        email: recipient,
      });
      const renderedText = interpolatePlaceholders(template.text, {
        ...person,
        email: recipient,
      });
      const fallbackResp = await fetchResendJson(RESEND_API_URL, apiKey, {
        method: "POST",
        body: JSON.stringify({
          from,
          to: [recipient],
          subject,
          ...(template.reply_to ? { reply_to: template.reply_to } : {}),
          ...(renderedHtml ? { html: renderedHtml } : {}),
          ...(renderedText ? { text: renderedText } : {}),
        }),
      });

      if (!fallbackResp.ok) {
        const message =
          fallbackResp.data?.message ||
          fallbackResp.data?.error ||
          `Resend error (${fallbackResp.status})`;
        throw new Error(message);
      }

      return {
        id: fallbackResp.data?.id ?? null,
        templateId: template.id,
        mode: "resend_template_rendered",
      };
    }
  }

  // 2. Check if user created a matching Broadcast in Resend
  const broadcast = await resolveRecentBroadcastTemplate(apiKey);
  if (broadcast) {
    const from = broadcast.from || defaultFrom;
    const subject = interpolatePlaceholders(
      broadcast.subject ||
        process.env.RESEND_LEAD_MAGNET_SUBJECT?.trim() ||
        DEFAULT_LEAD_MAGNET_SUBJECT,
      { ...person, email: recipient }
    );
    const html = interpolatePlaceholders(broadcast.html, {
      ...person,
      email: recipient,
    });
    const text = interpolatePlaceholders(broadcast.text, {
      ...person,
      email: recipient,
    });

    const sendResp = await fetchResendJson(RESEND_API_URL, apiKey, {
      method: "POST",
      body: JSON.stringify({
        from,
        to: [recipient],
        subject,
        ...(broadcast.reply_to ? { reply_to: broadcast.reply_to } : {}),
        ...(html ? { html } : {}),
        ...(text ? { text } : {}),
      }),
    });

    if (!sendResp.ok) {
      const message =
        sendResp.data?.message ||
        sendResp.data?.error ||
        `Resend error (${sendResp.status})`;
      throw new Error(message);
    }

    return {
      id: sendResp.data?.id ?? null,
      templateId: broadcast.id,
      mode: "resend_broadcast_rendered",
    };
  }

  // 3. Default fallback email if no template has been created in Resend yet
  const fallback = buildFallbackLeadMagnetEmail({
    ...person,
    email: recipient,
  });

  const sendResp = await fetchResendJson(RESEND_API_URL, apiKey, {
    method: "POST",
    body: JSON.stringify({
      from: defaultFrom,
      to: [recipient],
      subject: fallback.subject,
      html: fallback.html,
      text: fallback.text,
    }),
  });

  if (!sendResp.ok) {
    const message =
      sendResp.data?.message ||
      sendResp.data?.error ||
      `Resend error (${sendResp.status})`;
    throw new Error(message);
  }

  return {
    id: sendResp.data?.id ?? null,
    templateId: null,
    mode: "fallback_email",
  };
}

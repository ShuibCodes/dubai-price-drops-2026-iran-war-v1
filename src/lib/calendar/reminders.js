import { sendIMessageText } from "@/lib/imessage/send";

export const DEFAULT_REMINDER_WINDOW_MINUTES = 30;
export const DEFAULT_TIMEZONE = "Asia/Dubai";

export function formatMeetingReminderTime(isoString, timeZone = DEFAULT_TIMEZONE) {
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) return "upcoming";

  const tz = String(timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

export function composeMeetingReminder({
  appointment,
  agent,
  lead,
  now = new Date(),
}) {
  const startMs = new Date(appointment?.start_at).getTime();
  const nowMs = now.getTime();
  const diffMinutes = Math.max(1, Math.round((startMs - nowMs) / 60000));

  const timeZone = appointment?.timezone || agent?.tz || DEFAULT_TIMEZONE;
  const timeFormatted = formatMeetingReminderTime(appointment?.start_at, timeZone);
  const timeDescription =
    diffMinutes === 1 ? "in about 1 minute" : `in ~${diffMinutes} minutes`;

  const summary = appointment?.summary || "Viewing / Meeting";
  const lines = [
    `⏰ Meeting Reminder: You have an appointment ${timeDescription} at ${timeFormatted} (${timeZone}).`,
  ];

  if (lead) {
    const leadName = lead.push_name || "Lead";
    const leadPhone = lead.wa_id ? `+${lead.wa_id}` : "";
    const contactStr = [leadName, leadPhone].filter(Boolean).join(" ");
    lines.push(`With: ${contactStr}`);

    const contextParts = [];
    if (lead.budget) contextParts.push(`Budget: AED ${lead.budget}`);
    if (Array.isArray(lead.areas) && lead.areas.length) {
      contextParts.push(`Areas: ${lead.areas.join(", ")}`);
    } else if (typeof lead.areas === "string" && lead.areas.trim()) {
      contextParts.push(`Areas: ${lead.areas.trim()}`);
    }
    if (contextParts.length) {
      lines.push(`Context: ${contextParts.join(" · ")}`);
    }
  }

  lines.push(`Details: ${summary}`);
  return lines.join("\n");
}

export function isAppointmentDueForReminder(
  appointment,
  { now = new Date(), windowMinutes = DEFAULT_REMINDER_WINDOW_MINUTES } = {}
) {
  if (!appointment || appointment.status !== "booked") return false;

  // Idempotency: skip if already sent
  if (appointment.raw?.reminder_sent_at || appointment.reminder_sent_at) {
    return false;
  }

  const startMs = new Date(appointment.start_at).getTime();
  if (!Number.isFinite(startMs)) return false;

  const nowMs = now.getTime();
  // Upcoming: between (now - 2 minutes grace period) and (now + windowMinutes)
  const minStart = nowMs - 2 * 60000;
  const maxStart = nowMs + windowMinutes * 60000;

  return startMs >= minStart && startMs <= maxStart;
}

export async function findUpcomingAppointments(
  supabase,
  { now = new Date(), windowMinutes = DEFAULT_REMINDER_WINDOW_MINUTES } = {}
) {
  if (!supabase) return [];

  const startWindow = new Date(now.getTime() - 2 * 60000).toISOString();
  const endWindow = new Date(now.getTime() + windowMinutes * 60000).toISOString();

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select(
      "id, tenant_id, agent_id, lead_id, jarvis_lead_id, call_id, vapi_call_id, summary, start_at, end_at, timezone, provider_event_id, status, raw"
    )
    .eq("status", "booked")
    .gte("start_at", startWindow)
    .lte("start_at", endWindow);

  if (error) {
    throw new Error(`Failed to query upcoming appointments: ${error.message}`);
  }

  return (appointments || []).filter((apt) =>
    isAppointmentDueForReminder(apt, { now, windowMinutes })
  );
}

export async function sendMeetingReminder({
  supabase,
  appointment,
  agent = null,
  lead = null,
  now = new Date(),
  sendIMessage = sendIMessageText,
}) {
  if (!appointment?.id) {
    return { sent: false, reason: "missing_appointment" };
  }

  let resolvedAgent = agent;
  if (!resolvedAgent && appointment.agent_id && supabase) {
    const { data: agentData } = await supabase
      .from("agents")
      .select("id, name, wa_id, imessage_address, preferred_channel, tz, tenant_id")
      .eq("id", appointment.agent_id)
      .maybeSingle();
    resolvedAgent = agentData;
  }

  if (!resolvedAgent) {
    return { sent: false, reason: "no_agent_found", appointmentId: appointment.id };
  }

  let resolvedLead = lead;
  if (!resolvedLead && supabase) {
    if (appointment.lead_id) {
      const { data: leadData } = await supabase
        .from("leads")
        .select("id, push_name, wa_id, budget, areas")
        .eq("id", appointment.lead_id)
        .maybeSingle();
      resolvedLead = leadData;
    } else if (appointment.jarvis_lead_id) {
      const { data: jLeadData } = await supabase
        .from("jarvis_leads")
        .select("id, push_name, wa_id")
        .eq("id", appointment.jarvis_lead_id)
        .maybeSingle();
      resolvedLead = jLeadData;
    }
  }

  // Meeting reminders for iMessage
  if (resolvedAgent.preferred_channel === "imessage" || resolvedAgent.imessage_address) {
    const rawTo =
      resolvedAgent.imessage_address ||
      (resolvedAgent.wa_id ? `+${resolvedAgent.wa_id}` : null);
    const to = String(rawTo || "").trim();

    if (!to || to === "+") {
      return {
        sent: false,
        reason: "no_agent_imessage_address",
        appointmentId: appointment.id,
      };
    }

    const body = composeMeetingReminder({
      appointment,
      agent: resolvedAgent,
      lead: resolvedLead,
      now,
    });

    try {
      const sendResult = await sendIMessage({ to, body });

      // Record reminder in appointments.raw for idempotency
      const updatedRaw = {
        ...(appointment.raw || {}),
        reminder_sent_at: now.toISOString(),
        reminder_channel: "imessage",
      };

      if (supabase) {
        await supabase
          .from("appointments")
          .update({ raw: updatedRaw })
          .eq("id", appointment.id);
      }

      return {
        sent: true,
        via: "imessage",
        appointmentId: appointment.id,
        to,
        result: sendResult,
      };
    } catch (error) {
      console.error(
        `[calendar/reminders] iMessage reminder failed for appointment ${appointment.id}: ${error.message}`
      );
      return {
        sent: false,
        reason: error.message,
        appointmentId: appointment.id,
        via: "imessage",
      };
    }
  }

  // Non-iMessage agents: preserved untouched as requested
  return {
    sent: false,
    reason: "channel_not_imessage",
    appointmentId: appointment.id,
  };
}

export async function processMeetingReminders({
  supabase,
  now = new Date(),
  windowMinutes = DEFAULT_REMINDER_WINDOW_MINUTES,
  sendIMessage = sendIMessageText,
} = {}) {
  const appointments = await findUpcomingAppointments(supabase, {
    now,
    windowMinutes,
  });

  const results = [];
  for (const appointment of appointments) {
    const result = await sendMeetingReminder({
      supabase,
      appointment,
      now,
      sendIMessage,
    });
    results.push(result);
  }

  const sentCount = results.filter((r) => r.sent).length;
  return {
    ok: true,
    found: appointments.length,
    sent: sentCount,
    results,
  };
}


export function formatAppointmentDateTime(isoString, timeZone = DEFAULT_TIMEZONE) {
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) return "Upcoming";

  const tz = String(timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function composeInstantBookingNotification({
  appointment,
  agent,
  lead,
  customerPhone,
}) {
  const timeZone = appointment?.timezone || agent?.tz || DEFAULT_TIMEZONE;
  const whenFormatted = formatAppointmentDateTime(appointment?.start_at, timeZone);
  const summary = appointment?.summary || "Viewing / Meeting";

  const lines = [
    "🎯 New Appointment Booked!",
    `• Event: ${summary}`,
    `• When: ${whenFormatted} (${timeZone})`,
  ];

  if (lead) {
    const leadName = lead.push_name || "Lead";
    const leadPhone = lead.wa_id
      ? `+${lead.wa_id}`
      : customerPhone
        ? `+${String(customerPhone).replace(/\D/g, "")}`
        : "";
    const contactStr = [leadName, leadPhone].filter(Boolean).join(" ");
    lines.push(`• Client: ${contactStr}`);

    const contextParts = [];
    if (lead.budget) contextParts.push(`Budget: AED ${lead.budget}`);
    if (Array.isArray(lead.areas) && lead.areas.length) {
      contextParts.push(`Areas: ${lead.areas.join(", ")}`);
    } else if (typeof lead.areas === "string" && lead.areas.trim()) {
      contextParts.push(`Areas: ${lead.areas.trim()}`);
    }
    if (contextParts.length) {
      lines.push(`• Details: ${contextParts.join(" · ")}`);
    }
  } else if (customerPhone) {
    const digits = String(customerPhone).replace(/\D/g, "");
    if (digits) {
      lines.push(`• Client Phone: +${digits}`);
    }
  }

  lines.push("Added directly to your Google Calendar.");
  return lines.join("\n");
}

export async function notifyAgentAppointmentBooked({
  supabase,
  appointment,
  agentId,
  leadId = null,
  jarvisLeadId = null,
  customerPhone = null,
  sendIMessage = sendIMessageText,
}) {
  if (!supabase || !appointment) {
    return { sent: false, reason: "missing_params" };
  }

  const resolvedAgentId = agentId || appointment.agent_id;
  if (!resolvedAgentId) {
    return { sent: false, reason: "missing_agent_id" };
  }

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, name, wa_id, imessage_address, preferred_channel, tz, tenant_id")
    .eq("id", resolvedAgentId)
    .maybeSingle();

  if (agentError) {
    console.error("[reminders] agent lookup error:", agentError.message);
  }

  if (!agent) {
    return { sent: false, reason: "agent_not_found" };
  }

  // Only proactive iMessage if agent preferred channel is imessage
  if (agent.preferred_channel !== "imessage") {
    return { sent: false, reason: "not_imessage_channel" };
  }

  const rawTo = agent.imessage_address || (agent.wa_id ? `+${agent.wa_id}` : null);
  const to = String(rawTo || "").trim();
  if (!to || to === "+") {
    return { sent: false, reason: "no_agent_imessage_address" };
  }

  let lead = null;
  const targetLeadId = leadId || appointment.lead_id;
  const targetJarvisLeadId = jarvisLeadId || appointment.jarvis_lead_id;

  if (targetLeadId) {
    const { data: leadData } = await supabase
      .from("leads")
      .select("id, push_name, wa_id, budget, areas")
      .eq("id", targetLeadId)
      .maybeSingle();
    lead = leadData;
  } else if (targetJarvisLeadId) {
    const { data: jLeadData } = await supabase
      .from("jarvis_leads")
      .select("id, push_name, wa_id")
      .eq("id", targetJarvisLeadId)
      .maybeSingle();
    lead = jLeadData;
  }

  const body = composeInstantBookingNotification({
    appointment,
    agent,
    lead,
    customerPhone,
  });

  try {
    const sendResult = await sendIMessage({ to, body });
    console.log(
      `[reminders/instant] sent booking confirmation to ${to} for appointment ${appointment.id}`
    );

    if (appointment.id) {
      await supabase
        .from("appointments")
        .update({
          raw: {
            ...(appointment.raw || {}),
            instant_notified_at: new Date().toISOString(),
            instant_notified_channel: "imessage",
          },
        })
        .eq("id", appointment.id)
        .catch(() => {});
    }

    return { sent: true, via: "imessage", to, body, sendResult };
  } catch (error) {
    console.error("[reminders/instant] iMessage send failed:", error.message);
    return { sent: false, reason: error.message };
  }
}

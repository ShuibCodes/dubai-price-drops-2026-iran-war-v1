import assert from "node:assert/strict";
import {
  formatAppointmentDateTime,
  composeInstantBookingNotification,
  notifyAgentAppointmentBooked,
} from "../src/lib/calendar/reminders.js";

console.log("Running QA tests for Instant Booking Notification...\n");

// 1. Test formatAppointmentDateTime
{
  const iso = "2026-11-12T10:00:00.000Z";
  const formatted = formatAppointmentDateTime(iso, "Asia/Dubai");
  assert.ok(formatted.includes("Nov 12"), "Should include month and day");
  assert.ok(formatted.includes("2:00 PM"), "Should convert 10:00 UTC to 2:00 PM Asia/Dubai");
  console.log("✓ formatAppointmentDateTime formats ISO string into readable date and time");
}

// 2. Test composeInstantBookingNotification
{
  const appointment = {
    summary: "Luxury Villa Viewing",
    start_at: "2026-11-12T10:00:00.000Z",
    timezone: "Asia/Dubai",
  };
  const agent = { name: "Alex", tz: "Asia/Dubai" };
  const lead = {
    push_name: "Fatima Al-Mansoor",
    wa_id: "971501112233",
    budget: "8M",
    areas: ["Palm Jumeirah"],
  };

  const body = composeInstantBookingNotification({ appointment, agent, lead });
  assert.ok(body.includes("🎯 New Appointment Booked!"), "Header present");
  assert.ok(body.includes("Luxury Villa Viewing"), "Event summary present");
  assert.ok(body.includes("Fatima Al-Mansoor"), "Lead name present");
  assert.ok(body.includes("+971501112233"), "Lead phone present");
  assert.ok(body.includes("Budget: AED 8M"), "Budget present");
  assert.ok(body.includes("Palm Jumeirah"), "Area present");
  assert.ok(body.includes("Added directly to your Google Calendar."), "Footer present");
  console.log("✓ composeInstantBookingNotification builds complete instant booking text");
}

// 3. Test notifyAgentAppointmentBooked with iMessage agent
{
  let sentMessage = null;
  let updatedAppointment = null;

  const mockSupabase = {
    from: (table) => {
      if (table === "agents") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "agent-1",
                  name: "Alex",
                  preferred_channel: "imessage",
                  imessage_address: "+971586689688",
                  tz: "Asia/Dubai",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "lead-1",
                  push_name: "Ahmed",
                  wa_id: "971509998877",
                  budget: "3.5M",
                  areas: ["Dubai Hills"],
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "appointments") {
        return {
          update: (payload) => ({
            eq: (_col, id) => {
              updatedAppointment = { id, ...payload };
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {};
    },
  };

  const mockSendIMessage = async ({ to, body }) => {
    sentMessage = { to, body };
    return { id: "msg_test_123" };
  };

  const res = await notifyAgentAppointmentBooked({
    supabase: mockSupabase,
    appointment: {
      id: "apt-123",
      summary: "Downtown Viewing",
      start_at: "2026-11-12T10:00:00.000Z",
      timezone: "Asia/Dubai",
    },
    agentId: "agent-1",
    leadId: "lead-1",
    sendIMessage: mockSendIMessage,
  });

  assert.equal(res.sent, true);
  assert.equal(res.via, "imessage");
  assert.equal(sentMessage.to, "+971586689688");
  assert.ok(sentMessage.body.includes("Ahmed"));
  assert.ok(updatedAppointment.raw.instant_notified_at != null);
  console.log("✓ notifyAgentAppointmentBooked sends iMessage to agent and records raw.instant_notified_at");
}

// 4. Test notifyAgentAppointmentBooked skips WhatsApp agents
{
  let sentMessage = null;

  const mockSupabase = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: "agent-2",
              name: "Omar",
              preferred_channel: "whatsapp",
              wa_id: "971501234567",
            },
            error: null,
          }),
        }),
      }),
    }),
  };

  const res = await notifyAgentAppointmentBooked({
    supabase: mockSupabase,
    appointment: {
      id: "apt-456",
      summary: "Viewing",
      start_at: "2026-11-12T10:00:00.000Z",
    },
    agentId: "agent-2",
    sendIMessage: async () => {
      sentMessage = true;
    },
  });

  assert.equal(res.sent, false);
  assert.equal(res.reason, "not_imessage_channel");
  assert.equal(sentMessage, null);
  console.log("✓ notifyAgentAppointmentBooked skips WhatsApp agents cleanly");
}

console.log("\nAll Instant Booking Notification QA tests passed successfully!\n");

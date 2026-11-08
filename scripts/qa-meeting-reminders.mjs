import assert from "node:assert/strict";
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const {
  formatMeetingReminderTime,
  composeMeetingReminder,
  isAppointmentDueForReminder,
  findUpcomingAppointments,
  sendMeetingReminder,
  processMeetingReminders,
} = await import("../src/lib/calendar/reminders.js");

function createMockSupabase({
  appointments = [],
  agents = [],
  leads = [],
  jarvis_leads = [],
} = {}) {
  const store = {
    appointments: JSON.parse(JSON.stringify(appointments)),
    agents: JSON.parse(JSON.stringify(agents)),
    leads: JSON.parse(JSON.stringify(leads)),
    jarvis_leads: JSON.parse(JSON.stringify(jarvis_leads)),
  };

  return {
    _store: store,
    from(table) {
      let selectedFields = "*";
      const filters = [];
      let gteFilter = null;
      let lteFilter = null;
      let updatePayload = null;

      return {
        select(fields) {
          selectedFields = fields;
          return this;
        },
        eq(col, val) {
          filters.push([col, val]);
          return this;
        },
        gte(col, val) {
          gteFilter = [col, val];
          return this;
        },
        lte(col, val) {
          lteFilter = [col, val];
          return this;
        },
        update(payload) {
          updatePayload = payload;
          return this;
        },
        async maybeSingle() {
          const rows = store[table] || [];
          const match = rows.find((r) =>
            filters.every(([c, v]) => r[c] === v)
          );
          return { data: match || null, error: null };
        },
        then(resolve) {
          const rows = store[table] || [];
          if (updatePayload) {
            // Apply update to matching rows
            for (const row of rows) {
              if (filters.every(([c, v]) => row[c] === v)) {
                Object.assign(row, updatePayload);
              }
            }
            return resolve({ data: null, error: null });
          }

          let matched = rows.filter((r) =>
            filters.every(([c, v]) => r[c] === v)
          );
          if (gteFilter) {
            matched = matched.filter(
              (r) => new Date(r[gteFilter[0]]) >= new Date(gteFilter[1])
            );
          }
          if (lteFilter) {
            matched = matched.filter(
              (r) => new Date(r[lteFilter[0]]) <= new Date(lteFilter[1])
            );
          }
          return resolve({ data: matched, error: null });
        },
      };
    },
  };
}

console.log("Running QA tests for Meeting Reminders...\n");

const BASE_NOW = new Date("2026-11-06T10:00:00.000Z");

// 1. Time formatting
{
  const formatted = formatMeetingReminderTime("2026-11-06T10:30:00.000Z", "Asia/Dubai");
  assert.ok(formatted.includes("2:30") || formatted.includes("14:30") || formatted.includes("PM"));
  console.log("✓ formatMeetingReminderTime formats ISO string into readable time");
}

// 2. Reminder composition
{
  const appointment = {
    start_at: "2026-11-06T10:25:00.000Z",
    timezone: "Asia/Dubai",
    summary: "Viewing: Palm Jumeirah Villa",
  };
  const agent = { name: "Om", tz: "Asia/Dubai" };
  const lead = {
    push_name: "Bruce Wayne",
    wa_id: "971501234567",
    budget: "15M",
    areas: ["Palm Jumeirah"],
  };

  const body = composeMeetingReminder({
    appointment,
    agent,
    lead,
    now: BASE_NOW,
  });

  assert.ok(body.includes("Meeting Reminder"));
  assert.ok(body.includes("25 minutes"));
  assert.ok(body.includes("Bruce Wayne +971501234567"));
  assert.ok(body.includes("Budget: AED 15M"));
  assert.ok(body.includes("Palm Jumeirah"));
  assert.ok(body.includes("Viewing: Palm Jumeirah Villa"));
  console.log("✓ composeMeetingReminder builds rich reminder text");
}

// 3. Due checks
{
  // In window: 20 mins from now
  assert.equal(
    isAppointmentDueForReminder(
      {
        status: "booked",
        start_at: new Date(BASE_NOW.getTime() + 20 * 60000).toISOString(),
      },
      { now: BASE_NOW, windowMinutes: 30 }
    ),
    true
  );

  // Past meeting: 10 mins ago
  assert.equal(
    isAppointmentDueForReminder(
      {
        status: "booked",
        start_at: new Date(BASE_NOW.getTime() - 10 * 60000).toISOString(),
      },
      { now: BASE_NOW, windowMinutes: 30 }
    ),
    false
  );

  // Far future: 2 hours from now
  assert.equal(
    isAppointmentDueForReminder(
      {
        status: "booked",
        start_at: new Date(BASE_NOW.getTime() + 120 * 60000).toISOString(),
      },
      { now: BASE_NOW, windowMinutes: 30 }
    ),
    false
  );

  // Cancelled meeting
  assert.equal(
    isAppointmentDueForReminder(
      {
        status: "cancelled",
        start_at: new Date(BASE_NOW.getTime() + 15 * 60000).toISOString(),
      },
      { now: BASE_NOW, windowMinutes: 30 }
    ),
    false
  );

  // Already sent reminder (idempotent)
  assert.equal(
    isAppointmentDueForReminder(
      {
        status: "booked",
        start_at: new Date(BASE_NOW.getTime() + 15 * 60000).toISOString(),
        raw: { reminder_sent_at: "2026-11-06T09:45:00.000Z" },
      },
      { now: BASE_NOW, windowMinutes: 30 }
    ),
    false
  );

  console.log("✓ isAppointmentDueForReminder enforces status, window, and idempotency");
}

// 4. End-to-end processMeetingReminders with iMessage delivery
{
  let sentPayload = null;
  const mockSendIMessage = async (payload) => {
    sentPayload = payload;
    return { messageId: "sb-msg-remind-1" };
  };

  const aptId = "apt-123";
  const agentId = "agent-om-uuid";
  const leadId = "lead-789";

  const db = createMockSupabase({
    appointments: [
      {
        id: aptId,
        tenant_id: "tenant-1",
        agent_id: agentId,
        lead_id: leadId,
        summary: "Viewing: Dubai Hills 3BR",
        start_at: new Date(BASE_NOW.getTime() + 20 * 60000).toISOString(),
        end_at: new Date(BASE_NOW.getTime() + 50 * 60000).toISOString(),
        timezone: "Asia/Dubai",
        status: "booked",
        raw: {},
      },
    ],
    agents: [
      {
        id: agentId,
        name: "Om Thombre",
        wa_id: "918591730489",
        imessage_address: "+918591730489",
        preferred_channel: "imessage",
        tenant_id: "tenant-1",
      },
    ],
    leads: [
      {
        id: leadId,
        push_name: "Tony Stark",
        wa_id: "971509990000",
        budget: "8M",
        areas: ["Dubai Hills"],
      },
    ],
  });

  const outcome = await processMeetingReminders({
    supabase: db,
    now: BASE_NOW,
    windowMinutes: 30,
    sendIMessage: mockSendIMessage,
  });

  assert.equal(outcome.found, 1);
  assert.equal(outcome.sent, 1);
  assert.equal(sentPayload?.to, "+918591730489");
  assert.ok(sentPayload?.body.includes("Tony Stark +971509990000"));
  assert.ok(sentPayload?.body.includes("Viewing: Dubai Hills 3BR"));

  // Check that the appointment's raw was updated with reminder_sent_at
  const updatedApt = db._store.appointments.find((a) => a.id === aptId);
  assert.ok(updatedApt.raw?.reminder_sent_at);
  assert.equal(updatedApt.raw?.reminder_channel, "imessage");
  console.log("✓ processMeetingReminders dispatches iMessage and persists raw.reminder_sent_at");

  // Second run: should NOT send again!
  const secondRun = await processMeetingReminders({
    supabase: db,
    now: BASE_NOW,
    windowMinutes: 30,
    sendIMessage: mockSendIMessage,
  });

  assert.equal(secondRun.found, 0, "Should skip already-reminded appointment");
  assert.equal(secondRun.sent, 0);
  console.log("✓ processMeetingReminders second run is strictly idempotent");
}

console.log("\nAll meeting reminders QA tests passed!\n");


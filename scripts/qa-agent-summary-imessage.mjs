import assert from "node:assert/strict";
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const { composeAgentMessage, sendAgentSummary } = await import(
  "../src/lib/notify/agent.js"
);

function createMockSupabase({ agents = [], tenants = [] } = {}) {
  return {
    from(table) {
      let selectedFields = "*";
      const filters = [];
      return {
        select(fields) {
          selectedFields = fields;
          return this;
        },
        eq(col, val) {
          filters.push([col, val]);
          return this;
        },
        async maybeSingle() {
          const rows = table === "agents" ? agents : table === "tenants" ? tenants : [];
          const match = rows.find((r) =>
            filters.every(([c, v]) => r[c] === v)
          );
          return { data: match || null, error: null };
        },
      };
    },
  };
}

console.log("Running QA tests for agent summary & iMessage notifications...\n");

// 1. Message formatting
{
  const msg = composeAgentMessage(
    { summary: "Client wants to view tomorrow at 4pm." },
    { push_name: "John Doe", wa_id: "971501112233" },
    {
      outcome: "qualified",
      intent: "Buy",
      budget_aed: "2.5M",
      areas: ["Downtown", "Business Bay"],
      timeline: "1 month",
      callback_time: "tomorrow 4pm",
    }
  );
  assert.ok(msg.includes("John Doe (+971501112233): qualified"));
  assert.ok(msg.includes("Downtown, Business Bay"));
  assert.ok(msg.includes("budget 2.5M"));
  console.log("✓ composeAgentMessage correctly formats structured details");
}

// 2. Non-notifiable outcome
{
  const result = await sendAgentSummary(
    { summary: "Left voicemail." },
    { push_name: "John", wa_id: "971500000000", assigned_agent_phone: "+971509998877" },
    { outcome: "voicemail" }
  );
  assert.equal(result.sent, false);
  assert.equal(result.reason, "outcome_not_notifiable");
  console.log("✓ sendAgentSummary ignores non-qualified/callback outcomes");
}

// 3. iMessage agent notification
{
  let sentPayload = null;
  const mockSendIMessage = async (payload) => {
    sentPayload = payload;
    return { messageId: "sb-msg-123" };
  };

  const mockSupabase = createMockSupabase({
    agents: [
      {
        id: "agent-om-uuid",
        name: "Om Thombre",
        wa_id: "918591730489",
        imessage_address: "+918591730489",
        preferred_channel: "imessage",
        tenant_id: "tenant-1",
      },
    ],
  });

  const result = await sendAgentSummary(
    { vapi_call_id: "call-123", summary: "Wants a 2-bed in Dubai Marina." },
    {
      id: "lead-456",
      push_name: "Sarah Connor",
      wa_id: "971507778899",
      assigned_agent_id: "agent-om-uuid",
      assigned_agent_phone: "+918591730489",
    },
    {
      outcome: "qualified",
      intent: "Buy",
      budget_aed: "2.2M",
      areas: ["Dubai Marina"],
    },
    null,
    { supabase: mockSupabase, sendIMessage: mockSendIMessage }
  );

  assert.equal(result.sent, true);
  assert.equal(result.via, "imessage");
  assert.equal(sentPayload?.to, "+918591730489");
  assert.ok(sentPayload?.body.includes("Sarah Connor (+971507778899): qualified"));
  console.log("✓ sendAgentSummary delivers qualified call to agent via iMessage");
}

// 4. WhatsApp agent untouched path
{
  let imessageCalled = false;
  const mockSendIMessage = async () => {
    imessageCalled = true;
  };

  const mockSupabase = createMockSupabase({
    agents: [
      {
        id: "agent-wa-uuid",
        name: "WhatsApp Agent",
        wa_id: "971501110000",
        preferred_channel: "whatsapp",
        tenant_id: "tenant-wa",
      },
    ],
    tenants: [
      {
        id: "tenant-wa",
        phone_number_id: "phone-id-123",
        business_token: "token-abc",
      },
    ],
  });

  // Since we don't mock fetch for WhatsApp Graph API in this test,
  // it should attempt WhatsApp and fail on fetch (or network), NOT call iMessage!
  const result = await sendAgentSummary(
    { vapi_call_id: "call-wa-123", tenant_id: "tenant-wa", summary: "Call summary." },
    {
      id: "lead-wa",
      push_name: "WA Lead",
      wa_id: "971500000001",
      assigned_agent_id: "agent-wa-uuid",
      assigned_agent_phone: "+971501110000",
    },
    { outcome: "qualified" },
    null,
    { supabase: mockSupabase, sendIMessage: mockSendIMessage }
  );

  assert.equal(imessageCalled, false, "iMessage should not be called for WhatsApp agent");
  // The WhatsApp path ran and caught fetch error (network)
  assert.equal(result.sent, false);
  console.log("✓ WhatsApp agents bypass iMessage and continue down WhatsApp logic");
}

console.log("\nAll agent summary iMessage QA tests passed!\n");


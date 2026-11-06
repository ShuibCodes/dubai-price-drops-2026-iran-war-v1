import assert from "node:assert/strict";
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const { normalizeQualification } = await import(
  "../src/lib/calls/qualification.js"
);
const { sendAgentSummary } = await import(
  "../src/lib/notify/agent.js"
);

console.log("Running QA tests for Anti-False-Positive Qualification Guards...\n");

// 1. Fake Lead (e.g. said "yes" to "hear me out?", then hung up)
{
  const fakeResult = normalizeQualification(
    {
      outcome: "qualified",
      lead_engaged: true,
      crm_note: "AgentZero AI Call — Qualified\nLead said yes to listening.",
    },
    "real_estate"
  );

  assert.equal(
    fakeResult.outcome,
    "not_interested",
    "Should downgrade fake qualified lead with no criteria to not_interested"
  );
  assert.equal(
    fakeResult.lead_engaged,
    false,
    "Should unset lead_engaged for fake lead"
  );
  assert.ok(
    !fakeResult.crm_note.includes("Qualified"),
    "CRM note must not say Qualified"
  );
  console.log("✓ Fake lead saying 'yes' without property criteria is downgraded to not_interested");
}

// 2. Fake Lead with callback time
{
  const callbackResult = normalizeQualification(
    {
      outcome: "qualified",
      callback_time: "tomorrow 2pm",
      crm_note: "AgentZero AI Call — Qualified",
    },
    "real_estate"
  );

  assert.equal(
    callbackResult.outcome,
    "callback",
    "Should downgrade to callback if callback_time is present"
  );
  assert.ok(
    callbackResult.crm_note.includes("Callback requested"),
    "CRM note should state callback requested"
  );
  console.log("✓ Fake lead with callback time is corrected to callback outcome");
}

// 3. Legitimate Qualified Leads with substantive criteria
{
  // A. With Intent + Area
  const withIntentAndArea = normalizeQualification(
    {
      outcome: "qualified",
      intent: "invest",
      areas: ["Dubai Marina"],
      lead_engaged: true,
    },
    "real_estate"
  );
  assert.equal(withIntentAndArea.outcome, "qualified");
  assert.equal(withIntentAndArea.lead_engaged, true);

  // B. With Budget
  const withBudget = normalizeQualification(
    {
      outcome: "qualified",
      budget_aed: "2500000",
      lead_engaged: true,
    },
    "real_estate"
  );
  assert.equal(withBudget.outcome, "qualified");

  // C. With Timeline
  const withTimeline = normalizeQualification(
    {
      outcome: "qualified",
      timeline: "within 1 month",
      lead_engaged: true,
    },
    "real_estate"
  );
  assert.equal(withTimeline.outcome, "qualified");

  console.log("✓ Legitimate qualified leads with intent, budget, areas, or timeline remain qualified");
}

// 4. Downstream Agent Notification Integration
{
  // When a fake lead is evaluated, sendAgentSummary MUST NOT send any message to the agent
  const fakeQualification = normalizeQualification(
    {
      outcome: "qualified",
      lead_engaged: true,
    },
    "real_estate"
  );

  const notifyResult = await sendAgentSummary(
    { summary: "AI asked to hear me out, lead said yes." },
    {
      id: "lead-1",
      push_name: "Passive Listener",
      wa_id: "971501112233",
      assigned_agent_phone: "+971509998877",
    },
    fakeQualification
  );

  assert.equal(notifyResult.sent, false);
  assert.equal(notifyResult.reason, "outcome_not_notifiable");
  console.log("✓ Agent notification is completely blocked for fake leads");
}

// 5. Course Profile (Pivot to Tech) Anti-False-Positive Guardrail
{
  const fakeCourse = normalizeQualification(
    {
      outcome: "qualified",
      lead_engaged: true,
      still_priority: null,
      ok_for_consultant: null,
    },
    "course"
  );

  assert.equal(
    fakeCourse.outcome,
    "not_interested",
    "Course lead without priority or consultant confirmation is downgraded"
  );

  const validCourse = normalizeQualification(
    {
      outcome: "qualified",
      lead_engaged: true,
      ok_for_consultant: true,
    },
    "course"
  );

  assert.equal(validCourse.outcome, "qualified");
  console.log("✓ Course profile anti-false-positive guardrail functions correctly");
}

console.log("\nAll anti-false-positive QA checks passed successfully!\n");


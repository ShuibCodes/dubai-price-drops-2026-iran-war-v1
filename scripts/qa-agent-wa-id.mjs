/**
 * QA tests for automatic agent wa_id population and edge cases.
 *
 * Runs completely standalone without requiring a live database.
 * Run with: node scripts/qa-agent-wa-id.mjs
 */

import { cleanWaId, assignAgentWaId } from "../src/lib/copilot/agent-wa-id.js";

let failures = 0;

function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
}

console.log("\n--- PHONE / WA_ID NORMALIZATION EDGE CASES ---");

// 1. UAE standard international with plus and spaces
check(
  "UAE international with plus and spaces",
  cleanWaId("+971 58 569 0693") === "971585690693"
);

// 2. UAE with dashes and brackets
check(
  "UAE with brackets and dashes",
  cleanWaId("+971 (58) 569-0693") === "971585690693"
);

// 3. UAE local with leading zero
check(
  "UAE local number starting with 05x",
  cleanWaId("058 569 0693") === "971585690693"
);

// 4. UAE bare 9-digit mobile (5xxxxxxxx)
check(
  "UAE bare 9-digit mobile without leading 0",
  cleanWaId("585690693") === "971585690693"
);

// 5. UK mobile international format
check(
  "UK international mobile with spaces",
  cleanWaId("+44 7911 123456") === "447911123456"
);

// 6. US standard format
check(
  "US format with parentheses and dashes",
  cleanWaId("+1 (555) 234-5678") === "15552345678"
);

// 7. Pure digits already
check(
  "Pure E.164 digits without plus",
  cleanWaId("971585690693") === "971585690693"
);

// 8. Stray characters / noise
check(
  "Stray dots and extension text stripped",
  cleanWaId("+971.58.569.0693") === "971585690693"
);

// 9. Invalid inputs
check("null input returns null", cleanWaId(null) === null);
check("undefined input returns null", cleanWaId(undefined) === null);
check("empty string returns null", cleanWaId("") === null);
check("spaces only returns null", cleanWaId("   ") === null);
check("alphabetic text returns null", cleanWaId("hello-world") === null);
check("too short (<6 digits) returns null", cleanWaId("12345") === null);
check("too long (>20 digits) returns null", cleanWaId("123456789012345678901") === null);

console.log("\n--- AGENT WA_ID ASSIGNMENT & CONFLICT HANDLING ---");

function createMockSupabase(initialAgents = []) {
  const agents = JSON.parse(JSON.stringify(initialAgents));
  const updates = [];

  return {
    _agents: agents,
    _updates: updates,
    from(table) {
      if (table !== "agents") throw new Error(`Unexpected table: ${table}`);

      return {
        select(cols) {
          return {
            eq(field, val) {
              return {
                maybeSingle: async () => {
                  const match = agents.find((a) => a[field] === val);
                  return { data: match || null, error: null };
                },
                neq(field2, val2) {
                  return {
                    maybeSingle: async () => {
                      const match = agents.find(
                        (a) => a[field] === val && a[field2] !== val2
                      );
                      return { data: match || null, error: null };
                    },
                  };
                },
              };
            },
          };
        },
        update(patch) {
          return {
            eq(field, val) {
              updates.push({ field, val, patch });
              const agent = agents.find((a) => a[field] === val);
              if (agent) {
                Object.assign(agent, patch);
              }
              return Promise.resolve({ data: agent, error: null });
            },
          };
        },
      };
    },
  };
}

// Scenario A: Fresh assignment to agent with null wa_id
{
  const db = createMockSupabase([
    { id: "agent-1", name: "Alice", wa_id: null, tenant_id: "tenant-1" },
  ]);

  const res = await assignAgentWaId(db, {
    agentId: "agent-1",
    rawPhone: "+971 58 569 0693",
  });

  check("assigns wa_id when agent has null wa_id", res.ok && res.waId === "971585690693");
  check("db row updated with normalized digits", db._agents[0].wa_id === "971585690693");
}

// Scenario B: Idempotent call when agent already has the same wa_id
{
  const db = createMockSupabase([
    { id: "agent-1", name: "Alice", wa_id: "971585690693", tenant_id: "tenant-1" },
  ]);

  const res = await assignAgentWaId(db, {
    agentId: "agent-1",
    rawPhone: "+971 58 569 0693",
  });

  check("idempotent when agent already has exact wa_id", res.ok && res.unchanged === true);
  check("no extra db updates fired on idempotent call", db._updates.length === 0);
}

// Scenario C: Conflict detection when another agent holds the number
{
  const db = createMockSupabase([
    { id: "agent-1", name: "Alice", wa_id: "971585690693", tenant_id: "tenant-1" },
    { id: "agent-2", name: "Bob", wa_id: null, tenant_id: "tenant-1" },
  ]);

  const res = await assignAgentWaId(db, {
    agentId: "agent-2",
    rawPhone: "+971 58 569 0693", // Alice already owns this number
  });

  check("detects conflict when another agent holds wa_id", !res.ok && res.conflict === true);
  check("identifies conflicting agent id", res.conflictingAgentId === "agent-1");
  check("does not overwrite Bob with duplicate wa_id", db._agents[1].wa_id === null);
}

// Scenario D: overwriteExisting = false skips when agent already has a different number
{
  const db = createMockSupabase([
    { id: "agent-1", name: "Alice", wa_id: "971501111111", tenant_id: "tenant-1" },
  ]);

  const res = await assignAgentWaId(db, {
    agentId: "agent-1",
    rawPhone: "+971 58 569 0693",
    overwriteExisting: false,
  });

  check("overwriteExisting=false skips update if wa_id present", res.ok && res.skipped === true);
  check("keeps existing wa_id untouched", db._agents[0].wa_id === "971501111111");
}

// Scenario E: Missing agent or missing DB
{
  const db = createMockSupabase([]);

  const resNoAgent = await assignAgentWaId(db, {
    agentId: "non-existent-agent",
    rawPhone: "+971 58 569 0693",
  });
  check("handles non-existent agent gracefully", !resNoAgent.ok && resNoAgent.error === "agent_not_found");

  const resNoDb = await assignAgentWaId(null, {
    agentId: "agent-1",
    rawPhone: "+971 58 569 0693",
  });
  check("handles null supabase client gracefully", !resNoDb.ok && resNoDb.error === "missing_supabase");

  const resBadPhone = await assignAgentWaId(db, {
    agentId: "agent-1",
    rawPhone: "invalid",
  });
  check("handles invalid phone gracefully", !resBadPhone.ok && resBadPhone.error === "invalid_phone");
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;

/**
 * Feedback tickets tenant isolation + validation.
 * No live HTTP, Supabase, or storage.
 *
 * node scripts/qa-feedback-tickets.mjs
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

process.env.ONBOARD_AUTH_SECRET ||= "qa-onboard-secret";
process.env.ONBOARD_AUTH_USERNAME ||= "staff";
process.env.ONBOARD_AUTH_PASSWORD ||= "staff-pass";

const { createOnboardSessionToken, ONBOARD_SESSION_COOKIE } = await import(
  "../src/lib/onboard-auth.js"
);
const { hasOnboardStaffSession } = await import("../src/lib/internal/http.js");
const { FeedbackError } = await import("../src/lib/feedback/access.js");
const {
  MAX_IMAGE_BYTES,
  validateImageFile,
} = await import("../src/lib/feedback/attachments.js");
const {
  addTicketComment,
  createTenantTicket,
  listTenantTickets,
  listTicketComments,
  loadStaffTicket,
  loadTenantAttachment,
  loadTenantTicket,
  publicTicket,
  rejectClientStaffFields,
  staffTicketPatch,
  updateStaffTicket,
} = await import("../src/lib/feedback/store.js");

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${detail || ""}`);
}

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const AGENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function createMemorySupabase(seed = {}) {
  const store = {
    tenants: [
      { id: TENANT_A, slug: "alpha", name: "Alpha" },
      { id: TENANT_B, slug: "beta", name: "Beta" },
      ...(seed.tenants || []),
    ],
    feedback_tickets: [...(seed.feedback_tickets || [])],
    feedback_comments: [...(seed.feedback_comments || [])],
    feedback_attachments: [...(seed.feedback_attachments || [])],
  };

  function from(table) {
    const state = {
      op: "select",
      filters: [],
      payload: null,
      order: null,
      single: false,
      maybe: false,
    };

    function matches(row) {
      return state.filters.every(([key, value]) => String(row[key]) === String(value));
    }

    function withTenants(row) {
      if (table !== "feedback_tickets") return row;
      const tenant = store.tenants.find((item) => item.id === row.tenant_id);
      return { ...row, tenants: tenant ? { slug: tenant.slug, name: tenant.name } : null };
    }

    async function execute() {
      let rows = (store[table] || []).filter(matches);
      if (state.op === "insert") {
        const input = Array.isArray(state.payload) ? state.payload : [state.payload];
        const created = input.map((row) => ({
          id: row.id || crypto.randomUUID(),
          created_at: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || new Date().toISOString(),
          ...row,
        }));
        store[table].push(...created);
        rows = created;
      } else if (state.op === "update") {
        const updated = [];
        store[table] = store[table].map((row) => {
          if (!matches(row)) return row;
          const next = { ...row, ...state.payload };
          updated.push(next);
          return next;
        });
        rows = updated;
      }
      if (state.order) {
        const [key, ascending] = state.order;
        rows = [...rows].sort((a, b) => {
          if (a[key] === b[key]) return 0;
          if (ascending) return a[key] > b[key] ? 1 : -1;
          return a[key] > b[key] ? -1 : 1;
        });
      }
      rows = rows.map(withTenants);
      if (state.single || state.maybe) {
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    }

    const builder = {
      select() {
        return builder;
      },
      insert(payload) {
        state.op = "insert";
        state.payload = payload;
        return builder;
      },
      update(payload) {
        state.op = "update";
        state.payload = payload;
        return builder;
      },
      eq(key, value) {
        state.filters.push([key, value]);
        return builder;
      },
      order(key, { ascending } = {}) {
        state.order = [key, Boolean(ascending)];
        return builder;
      },
      single() {
        state.single = true;
        return execute();
      },
      maybeSingle() {
        state.maybe = true;
        return execute();
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };
    return builder;
  }

  return { from, store };
}

const sessionA = { tenantId: TENANT_A, agentId: AGENT_A };
const sessionB = { tenantId: TENANT_B, agentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };

console.log("\nCREATE + LIST");
{
  const db = createMemorySupabase();
  const ticket = await createTenantTicket(db, sessionA, {
    type: "bug",
    title: "Play button fails",
    description: "Recording play returns 401.",
    tenant_id: TENANT_B,
    status: "closed",
  });
  check("create uses session tenant, not body tenant", ticket.tenant_id === TENANT_A);
  check("create forces status new", ticket.status === "new");
  check("create uses session agent", ticket.created_by_agent_id === AGENT_A);
  const listed = await listTenantTickets(db, sessionA.tenantId);
  check("same-tenant list includes the ticket", listed.some((row) => row.id === ticket.id));
  const other = await listTenantTickets(db, sessionB.tenantId);
  check("other tenant list is empty", other.length === 0);
  check("client DTO hides priority", listed[0].priority === undefined);
  check("client DTO hides assigned_to", listed[0].assigned_to === undefined);
}

console.log("\nSTAFF FIELDS REJECTED");
{
  let rejected = false;
  try {
    rejectClientStaffFields({ status: "closed" });
  } catch (error) {
    rejected = error instanceof FeedbackError && error.status === 400;
  }
  check("client cannot set status", rejected);
  rejected = false;
  try {
    rejectClientStaffFields({ priority: "high", assigned_to: "shuayb" });
  } catch (error) {
    rejected = error.status === 400;
  }
  check("client cannot set priority or assignee", rejected);
  rejected = false;
  try {
    rejectClientStaffFields({ tenant_id: TENANT_B });
  } catch (error) {
    rejected = error.status === 400;
  }
  check("client cannot send tenant_id", rejected);
}

console.log("\nINVALID INPUT");
{
  const db = createMemorySupabase();
  let failed = false;
  try {
    await createTenantTicket(db, sessionA, { type: "urgent", title: "x", description: "y" });
  } catch (error) {
    failed = error.status === 400;
  }
  check("invalid type is rejected", failed);
  failed = false;
  try {
    await createTenantTicket(db, sessionA, { type: "bug", title: "  ", description: "y" });
  } catch (error) {
    failed = error.status === 400;
  }
  check("empty title is rejected", failed);
  failed = false;
  try {
    staffTicketPatch({ status: "done" });
  } catch (error) {
    failed = error.status === 400;
  }
  check("invalid status is rejected", failed);
}

console.log("\nDETAIL + COMMENTS");
{
  const db = createMemorySupabase();
  const ticket = await createTenantTicket(db, sessionA, {
    type: "feature",
    title: "Export CSV",
    description: "Need a CSV of run results.",
  });
  const loaded = await loadTenantTicket(db, TENANT_A, ticket.id);
  check("same-tenant detail loads", loaded.id === ticket.id);
  let missing = false;
  try {
    await loadTenantTicket(db, TENANT_B, ticket.id);
  } catch (error) {
    missing = error.status === 404;
  }
  check("cross-tenant ticket GET is 404", missing);
  const comment = await addTicketComment(db, {
    tenantId: TENANT_A,
    ticketId: ticket.id,
    authorKind: "client",
    authorAgentId: AGENT_A,
    body: "Still happening today.",
  });
  check("same-tenant comment is stored", comment.author_kind === "client");
  const comments = await listTicketComments(db, TENANT_A, ticket.id);
  check("same-tenant comments list", comments.length === 1);
  missing = false;
  try {
    await addTicketComment(db, {
      tenantId: TENANT_B,
      ticketId: ticket.id,
      authorKind: "client",
      body: "sneak",
    });
  } catch (error) {
    missing = error.status === 404;
  }
  check("cross-tenant comment POST is 404", missing);
}

console.log("\nATTACHMENTS");
{
  const db = createMemorySupabase();
  db.store.feedback_attachments.push({
    id: "att-a",
    tenant_id: TENANT_A,
    ticket_id: "ticket-a",
    filename: "shot.png",
    storage_path: `${TENANT_A}/${AGENT_A}/att-a-shot.png`,
    bytes: 1200,
    content_type: "image/png",
  });
  const row = await loadTenantAttachment(db, TENANT_A, "att-a");
  check("same-tenant attachment loads", row.id === "att-a");
  let missing = false;
  try {
    await loadTenantAttachment(db, TENANT_B, "att-a");
  } catch (error) {
    missing = error.status === 404;
  }
  check("cross-tenant attachment download is 404", missing);
  let typeOk = false;
  try {
    validateImageFile({ filename: "notes.pdf", contentType: "application/pdf", bytes: 100 });
  } catch (error) {
    typeOk = error.status === 400;
  }
  check("non-image attachment is rejected", typeOk);
  let sizeOk = false;
  try {
    validateImageFile({
      filename: "huge.jpg",
      contentType: "image/jpeg",
      bytes: MAX_IMAGE_BYTES + 1,
    });
  } catch (error) {
    sizeOk = error.status === 400;
  }
  check("oversize image is rejected", sizeOk);
  const ok = validateImageFile({
    filename: "shot.png",
    contentType: "image/png",
    bytes: 2048,
  });
  check("png image is accepted", ok.contentType === "image/png");
}

console.log("\nINTERNAL AUTH + STAFF PATCH");
{
  const copilotOnly = {
    cookies: {
      get(name) {
        if (name === "copilot_session") return { value: "not-staff" };
        return undefined;
      },
    },
  };
  check(
    "internal APIs reject Copilot authentication",
    hasOnboardStaffSession(copilotOnly) === false
  );
  const token = createOnboardSessionToken();
  const staffReq = {
    cookies: {
      get(name) {
        if (name === ONBOARD_SESSION_COOKIE) return { value: token };
        return undefined;
      },
    },
  };
  check("onboard HMAC session is accepted for staff", hasOnboardStaffSession(staffReq) === true);

  const db = createMemorySupabase();
  const ticket = await createTenantTicket(db, sessionA, {
    type: "improvement",
    title: "Quieter empty state",
    description: "Home is a bit empty on day one.",
  });
  const patched = staffTicketPatch({
    status: "in_progress",
    priority: "high",
    assigned_to: "Shuayb",
  });
  check("staff can move new → in_progress", patched.status === "in_progress");
  check("staff can set priority", patched.priority === "high");
  const updated = await updateStaffTicket(db, ticket.id, {
    status: "resolved",
    priority: "normal",
    assigned_to: "Shuayb",
  });
  check("staff update persists", updated.status === "resolved" && updated.assigned_to === "Shuayb");
  const staffView = publicTicket(updated, { staff: true });
  check("staff DTO includes tenant and priority", Boolean(staffView.tenant_id && staffView.priority));
  const loaded = await loadStaffTicket(db, ticket.id);
  check("staff can open any tenant ticket", loaded.tenant_id === TENANT_A);
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;

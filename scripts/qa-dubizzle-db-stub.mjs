/**
 * In-memory Supabase stand-in for Dubizzle address + webhook QA.
 */
function matches(row, filters) {
  return filters.every((filter) => {
    const left = row[filter.column];
    if (filter.op === "eq") return left === filter.value;
    if (filter.op === "is") {
      if (filter.value === null) return left == null;
      return left === filter.value;
    }
    if (filter.op === "in") return filter.value.includes(left);
    return false;
  });
}

function uniqueError(message) {
  return { code: "23505", message };
}

export function createDubizzleDb() {
  const db = {
    calls: [],
    rows: {
      tenants: [],
      inbound_leads: [],
      retired_inbound_emails: [],
    },
    from(table) {
      const filters = [];
      const state = { payload: null, op: "select", columns: "*" };

      const finishInsert = () => {
        db.calls.push({ table, op: "insert", payload: state.payload });
        if (table === "inbound_leads") {
          const emailId = state.payload.resend_email_id;
          if (db.rows.inbound_leads.some((row) => row.resend_email_id === emailId)) {
            return { data: null, error: uniqueError("duplicate resend_email_id") };
          }
          const row = {
            id: state.payload.id || `lead-${db.rows.inbound_leads.length + 1}`,
            skip_reason: null,
            created_at: new Date().toISOString(),
            ...state.payload,
          };
          db.rows.inbound_leads.push(row);
          return { data: { ...row }, error: null };
        }
        if (table === "retired_inbound_emails") {
          const email = state.payload.email;
          if (db.rows.retired_inbound_emails.some((row) => row.email === email)) {
            return { data: null, error: uniqueError("duplicate retired email") };
          }
          const row = {
            retired_at: new Date().toISOString(),
            ...state.payload,
          };
          db.rows.retired_inbound_emails.push(row);
          return { data: { ...row }, error: null };
        }
        return { data: state.payload, error: null };
      };

      const finishSelect = () => {
        db.calls.push({ table, op: "select", filters: [...filters] });
        const matched = (db.rows[table] || []).filter((row) => matches(row, filters));
        return matched;
      };

      const finishUpdate = () => {
        db.calls.push({
          table,
          op: "update",
          filters: [...filters],
          payload: state.payload,
        });
        const matched = (db.rows[table] || []).filter((row) => matches(row, filters));
        if (table === "tenants" && state.payload?.inbound_email) {
          const taken = db.rows.tenants.some(
            (row) =>
              row.inbound_email === state.payload.inbound_email &&
              !matches(row, filters)
          );
          if (taken) return { data: null, error: uniqueError("duplicate inbound_email") };
        }
        for (const row of matched) Object.assign(row, state.payload);
        return { data: matched[0] ? { ...matched[0] } : null, error: null };
      };

      const thenable = (run) => {
        const promise = () => Promise.resolve(run());
        return {
          then: (resolve, reject) => promise().then(resolve, reject),
          maybeSingle: async () => {
            const result = run();
            if (result.error) return result;
            if (state.op === "select") {
              const matched = result;
              if (matched.length > 1) {
                return { data: null, error: { message: "multiple rows" } };
              }
              return { data: matched[0] ? { ...matched[0] } : null, error: null };
            }
            return result;
          },
          single: async () => {
            const result = await thenable(run).maybeSingle();
            if (!result.error && !result.data) {
              return { data: null, error: { message: "no rows" } };
            }
            return result;
          },
        };
      };

      const chain = {
        select(columns) {
          state.op = state.payload ? state.op : "select";
          state.columns = columns;
          return chain;
        },
        insert(payload) {
          state.op = "insert";
          state.payload = payload;
          return chain;
        },
        update(payload) {
          state.op = "update";
          state.payload = payload;
          return chain;
        },
        eq(column, value) {
          filters.push({ op: "eq", column, value });
          return chain;
        },
        is(column, value) {
          filters.push({ op: "is", column, value });
          return chain;
        },
        maybeSingle() {
          if (state.op === "insert") return thenable(finishInsert).maybeSingle();
          if (state.op === "update") return thenable(finishUpdate).maybeSingle();
          return thenable(() => finishSelect()).maybeSingle();
        },
        single() {
          return chain.maybeSingle().then((result) => {
            if (!result.error && !result.data) {
              return { data: null, error: { message: "no rows" } };
            }
            return result;
          });
        },
        then(resolve, reject) {
          const run =
            state.op === "insert"
              ? finishInsert
              : state.op === "update"
                ? finishUpdate
                : () => ({ data: finishSelect(), error: null });
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return db;
}

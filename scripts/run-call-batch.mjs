import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { applyEnv, loadEnvFile } from "./load-env.mjs";
import {
  normalizePhone,
  resolveLeadSource,
} from "../src/lib/leads/normalize.js";
import {
  assertOutboundActive,
  dialLeadNow,
  isLeadWithinBusinessHours,
  nextLeadWindowStart,
  queueLeadCalls,
} from "../src/lib/calls/outbound.js";

applyEnv(loadEnvFile());

// Minimal CSV: Name, Phone, Client Source, House Type (course/interest hack → propertyInterest).
const PIXXI_COLUMN_MAP = {
  name: "Name",
  phone: "Phone",
  source: "Client Source",
  house_type: "House Type",
};

function parseArgs(argv) {
  const args = {
    dryRun: false,
    importOnly: false,
    limit: 50,
    delay: 60,
    concurrency: 1,
    csvPath: null,
    tenantSlug: process.env.TENANT_SLUG || "1416",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--import-only") args.importOnly = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--delay") args.delay = Number(argv[++i]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (arg === "--tenant") args.tenantSlug = String(argv[++i] || "").trim();
    else if (arg.startsWith("--tenant=")) {
      args.tenantSlug = arg.slice("--tenant=".length).trim();
    } else if (!arg.startsWith("--")) args.csvPath = arg;
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      if (ch === "\r") i += 1;
    } else {
      field += ch;
    }
  }

  if (field || row.length) {
    row.push(field);
    if (row.some((c) => c.trim())) rows.push(row);
  }

  return rows;
}

function mapHeaderIndex(headers) {
  const normalized = headers.map((h) => String(h || "").trim().toLowerCase());
  const index = {};
  for (const [key, label] of Object.entries(PIXXI_COLUMN_MAP)) {
    const idx = normalized.indexOf(String(label).trim().toLowerCase());
    if (idx !== -1) index[key] = idx;
  }
  return index;
}

function rowToFields(row, index) {
  const get = (key) => {
    const idx = index[key];
    return idx == null ? "" : String(row[idx] || "").trim();
  };
  return {
    name: get("name"),
    phone: get("phone"),
    pixxi_lead_id: get("pixxi_lead_id"),
    client_source: get("source"),
    agent_name: get("agent_name"),
    agent_phone: get("agent_phone"),
    rooms: get("rooms"),
    house_type: get("house_type"),
    community: get("community"),
    budget: get("budget"),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertLead(supabase, tenantId, fields) {
  const phone = normalizePhone(fields.phone);
  if (!phone) return null;
  const waId = phone.replace(/\D/g, "");
  const pixxiLeadId = fields.pixxi_lead_id || null;
  const now = new Date().toISOString();
  const leadSource = resolveLeadSource(fields);

  const row = {
    tenant_id: tenantId,
    wa_id: waId,
    push_name: fields.name || null,
    pixxi_lead_id: pixxiLeadId,
    assigned_agent_name: fields.agent_name || null,
    assigned_agent_phone: fields.agent_phone ? normalizePhone(fields.agent_phone) : null,
    source: leadSource,
    last_message_at: now,
    first_seen: now,
  };

  if (pixxiLeadId) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id, first_seen")
      .eq("tenant_id", tenantId)
      .eq("pixxi_lead_id", pixxiLeadId)
      .maybeSingle();
    if (existing) {
      const { data } = await supabase
        .from("leads")
        .update({ ...row, first_seen: existing.first_seen })
        .eq("id", existing.id)
        .select("*")
        .single();
      return data;
    }
  }

  const { data: byPhone } = await supabase
    .from("leads")
    .select("id, first_seen, pixxi_lead_id")
    .eq("tenant_id", tenantId)
    .eq("wa_id", waId)
    .maybeSingle();

  if (byPhone) {
    const { data } = await supabase
      .from("leads")
      .update({ ...row, first_seen: byPhone.first_seen, pixxi_lead_id: pixxiLeadId || byPhone.pixxi_lead_id })
      .eq("id", byPhone.id)
      .select("*")
      .single();
    return data;
  }

  const { data } = await supabase.from("leads").insert(row).select("*").single();
  return data;
}

async function dialOrQueue(supabase, tenant, lead, fields, dryRun) {
  assertOutboundActive(tenant);

  const phone = normalizePhone(fields.phone || lead.wa_id);
  if (!isLeadWithinBusinessHours(phone)) {
    if (dryRun) return { queued: true };
    const scheduledFor = nextLeadWindowStart(phone);
    await queueLeadCalls({
      supabase,
      tenantId: tenant.id,
      leadIds: [lead.id],
      scheduledTimes: [scheduledFor.toISOString()],
      source: "pixxi-batch",
    });
    return { queued: true };
  }

  if (dryRun) return { attempted: true };

  const result = await dialLeadNow({
    supabase,
    tenant,
    lead,
    fields,
    source: "pixxi-batch",
  });

  return { attempted: true, callId: result.callId };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.csvPath) {
    console.error(
      "Usage: node scripts/run-call-batch.mjs <csv-path> [--tenant slug] [--import-only] [--dry-run] [--limit N] [--delay SEC]"
    );
    process.exit(1);
  }
  if (!args.tenantSlug) {
    console.error("Missing --tenant slug (or TENANT_SLUG env)");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, slug, outbound_paused, vapi_assistant_id, vapi_phone_number_id")
    .eq("slug", args.tenantSlug)
    .maybeSingle();

  if (tenantError || !tenant) {
    console.error(
      `Tenant "${args.tenantSlug}" not found. Seed tenants.slug first.`
    );
    process.exit(1);
  }

  const csvText = fs.readFileSync(args.csvPath, "utf8");
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    console.error("CSV has no data rows");
    process.exit(1);
  }

  const index = mapHeaderIndex(rows[0]);
  const dataRows = rows.slice(1, 1 + args.limit);

  const report = { imported: 0, attempted: 0, queued: 0, skipped: 0 };

  for (const row of dataRows) {
    const fields = rowToFields(row, index);
    if (!normalizePhone(fields.phone)) {
      report.skipped += 1;
      continue;
    }

    const lead = await upsertLead(supabase, tenant.id, fields);
    if (!lead) {
      report.skipped += 1;
      continue;
    }
    report.imported += 1;

    // Import-only: upsert leads, never dial/queue (safe with outbound_paused).
    if (args.importOnly) continue;

    const result = await dialOrQueue(supabase, tenant, lead, fields, args.dryRun);
    if (result.queued) report.queued += 1;
    else if (result.attempted) report.attempted += 1;

    if (!args.dryRun && result.attempted && args.delay > 0) {
      await sleep(args.delay * 1000);
    }
  }

  console.log(`Batch complete (tenant=${tenant.slug}):`, report);
  if (args.importOnly) console.log("(import-only — leads upserted, no calls/queue)");
  else if (args.dryRun) console.log("(dry-run — no calls placed)");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

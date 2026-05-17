import fs from "fs";
import path from "path";
import { getAllLeadContacts } from "@/lib/kb/leads";

const CALLS_DIR = path.join(process.cwd(), "data", "calls");
const CALL_FRESHNESS_MS = 1000 * 60 * 60 * 24 * 14;

export function getCallsDir() {
  return CALLS_DIR;
}

export function ensureCallsDir() {
  if (!fs.existsSync(CALLS_DIR)) {
    fs.mkdirSync(CALLS_DIR, { recursive: true });
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizePhoneDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function phoneEndingsMatch(a, b) {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 8 && longer.endsWith(shorter);
}

function matchLeadByPhone(phone) {
  if (!phone) return null;
  const leads = getAllLeadContacts();
  return leads.find((lead) => phoneEndingsMatch(lead.phone, phone)) ?? null;
}

function safeFileName(value) {
  return clean(value)
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "call";
}

function formatTranscriptMessages(messages = []) {
  if (!Array.isArray(messages) || !messages.length) return "";
  return messages
    .filter((m) => m && (m.role || m.message))
    .map((m) => {
      const role = clean(m.role || m.speaker || "speaker");
      const text = clean(m.message || m.content || m.text);
      if (!text) return "";
      return `[${role}] ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

export function extractCallRecord(payload = {}) {
  const message = payload?.message ?? payload;
  const call = message?.call ?? payload?.call ?? {};
  const callId =
    clean(call?.id) ||
    clean(message?.callId) ||
    clean(payload?.callId) ||
    `call-${Date.now()}`;

  const customer = call?.customer ?? message?.customer ?? {};
  const customerNumber =
    clean(customer?.number) ||
    clean(call?.to) ||
    clean(call?.phoneNumber) ||
    "";
  const customerName = clean(customer?.name) || clean(call?.name) || "";
  const metadata = call?.metadata || message?.metadata || {};
  const metadataLeadName = clean(metadata?.leadName);

  const lead = matchLeadByPhone(customerNumber) ?? null;
  const leadName = lead?.name || metadataLeadName || customerName || "Unknown lead";

  const summary =
    clean(message?.analysis?.summary) ||
    clean(message?.summary) ||
    clean(call?.analysis?.summary) ||
    clean(call?.summary) ||
    "";

  const transcript =
    clean(message?.transcript) ||
    clean(call?.transcript) ||
    formatTranscriptMessages(message?.messages || call?.messages) ||
    "";

  const status =
    clean(message?.endedReason) ||
    clean(call?.status) ||
    clean(message?.status) ||
    "completed";

  const startedAt =
    clean(call?.startedAt) ||
    clean(message?.startedAt) ||
    clean(call?.createdAt) ||
    "";
  const endedAt =
    clean(call?.endedAt) ||
    clean(message?.endedAt) ||
    new Date().toISOString();

  return {
    callId,
    leadName,
    leadPhone: customerNumber,
    leadFileName: lead?.fileName || null,
    status,
    startedAt,
    endedAt,
    summary,
    transcript,
    metadata,
  };
}

export function formatCallRecord(record) {
  const lines = [
    `Call ID: ${record.callId}`,
    `Lead: ${record.leadName}${record.leadPhone ? ` | WhatsApp: ${record.leadPhone}` : ""}`,
    `Status: ${record.status}`,
  ];
  if (record.startedAt) lines.push(`Started: ${record.startedAt}`);
  if (record.endedAt) lines.push(`Ended: ${record.endedAt}`);
  lines.push("");
  lines.push("--- Call Summary ---");
  lines.push(record.summary || "(no summary produced by VAPI yet)");
  if (record.transcript) {
    lines.push("");
    lines.push("--- Transcript ---");
    lines.push(record.transcript);
  }
  return lines.join("\n");
}

export function writeCallRecord(record) {
  ensureCallsDir();
  const datePart = (record.endedAt || new Date().toISOString())
    .slice(0, 10)
    .replace(/-/g, "");
  const leadPart = safeFileName(record.leadName || "unknown");
  const idPart = safeFileName(record.callId).slice(0, 16);
  const fileName = `${datePart}-${leadPart}-${idPart}.txt`;
  const fullPath = path.join(CALLS_DIR, fileName);
  fs.writeFileSync(fullPath, formatCallRecord(record), "utf-8");
  return { fileName, fullPath };
}

export function listCallFiles() {
  if (!fs.existsSync(CALLS_DIR)) return [];
  return fs
    .readdirSync(CALLS_DIR)
    .filter((name) => name.toLowerCase().endsWith(".txt"))
    .map((name) => ({
      name,
      fullPath: path.join(CALLS_DIR, name),
      relPath: path.join("data", "calls", name),
    }));
}

export function getMostRecentCallFile() {
  const files = listCallFiles();
  if (!files.length) return null;
  let best = null;
  for (const file of files) {
    const stat = fs.statSync(file.fullPath);
    if (!best || stat.mtimeMs > best.mtimeMs) {
      best = { ...file, mtimeMs: stat.mtimeMs };
    }
  }
  if (!best) return null;
  best.content = fs.readFileSync(best.fullPath, "utf-8");
  const leadMatch = best.content.match(/^Lead:\s*([^|]+?)(?:\s*\|\s*WhatsApp:\s*([+0-9][0-9+\-\s]{6,}))?\s*$/m);
  best.leadName = leadMatch?.[1]?.trim() || "Unknown lead";
  best.leadPhone = leadMatch?.[2]?.trim() || null;
  return best;
}

export function getMostRecentCallForPhone(phone) {
  const target = normalizePhoneDigits(phone);
  if (!target) return null;
  const files = listCallFiles();
  let bestMatch = null;
  for (const file of files) {
    const content = fs.readFileSync(file.fullPath, "utf-8");
    const phoneLine = content.match(/WhatsApp:\s*([+0-9][0-9+\-\s]{6,})/i)?.[1];
    if (!phoneLine) continue;
    if (!phoneEndingsMatch(phoneLine, phone)) continue;
    const stat = fs.statSync(file.fullPath);
    const candidate = { ...file, content, mtimeMs: stat.mtimeMs };
    if (!bestMatch || candidate.mtimeMs > bestMatch.mtimeMs) {
      bestMatch = candidate;
    }
  }
  if (!bestMatch) return null;
  if (Date.now() - bestMatch.mtimeMs > CALL_FRESHNESS_MS) return bestMatch;
  return bestMatch;
}

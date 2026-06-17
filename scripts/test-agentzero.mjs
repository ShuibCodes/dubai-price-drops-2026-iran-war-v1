#!/usr/bin/env node
/**
 * Local AgentZero tester — simulates a WhatsApp message to /api/whatsapp.
 *
 * Usage:
 *   node scripts/test-agentzero.mjs "Any distressed deals from the groups?"
 *   node scripts/test-agentzero.mjs   # uses default query
 *
 * Requires: npm run dev (or deployed app) on BASE_URL (default http://localhost:3000)
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const query =
  process.argv.slice(2).join(" ").trim() ||
  "Any distressed property deals from the groups?";

const form = new URLSearchParams({
  From: "whatsapp:+971500000000",
  Body: query,
  MessageSid: `SMtest-${Date.now()}`,
});

console.log(`POST ${BASE_URL}/api/whatsapp`);
console.log(`Query: ${query}\n`);

const res = await fetch(`${BASE_URL}/api/whatsapp`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: form.toString(),
});

const xml = await res.text();
const match = xml.match(/<Message>([\s\S]*?)<\/Message>/);
const reply = match ? match[1].trim() : xml;

if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  console.error(reply);
  process.exit(1);
}

console.log("--- AgentZero reply ---");
console.log(reply);

// Signs in against a locally running dev server and walks every Copilot console
// screen, reporting status, timing, and the specific regressions fixed on this
// branch. Reads credentials from .env.local and never prints them.
//
//   node scripts/qa-console-walkthrough.mjs
//
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = process.env.QA_ORIGIN || "http://localhost:3001";

function loadEnv() {
  const text = readFileSync(join(ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[m[1]] = value;
  }
  return env;
}

const env = loadEnv();
let creds;
if (env.COPILOT_USERS_JSON) {
  const users = JSON.parse(env.COPILOT_USERS_JSON);
  creds = { username: users[0].username, password: users[0].password };
} else {
  creds = { username: env.COPILOT_USERNAME, password: env.COPILOT_PASSWORD };
}

const login = await fetch(`${ORIGIN}/api/copilot/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(creds),
});
const loginBody = await login.json();
if (!login.ok) {
  console.log(`LOGIN FAILED ${login.status} ${loginBody.error || ""}`);
  process.exit(1);
}
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
const tenant = loginBody.tenantSlug;
console.log(`login OK  tenant=${tenant}\n`);

const get = (path) => fetch(`${ORIGIN}${path}`, { headers: { cookie } });

console.log("API");
for (const path of [
  "/api/console/home",
  "/api/scripts",
  "/api/console/kb",
  "/api/console/lists",
  "/api/console/settings",
  "/api/console/profile",
]) {
  const t0 = Date.now();
  const res = await get(path);
  const body = await res.text();
  const ms = Date.now() - t0;
  const note = res.ok ? "" : `  <-- ${body.slice(0, 120)}`;
  console.log(
    `  ${String(res.status).padEnd(4)} ${String(ms).padStart(5)}ms  ${path}${note}`
  );
}

const home = await (await get("/api/console/home")).json();
const scripts = await (await get("/api/scripts")).json();
const settings = await (await get("/api/console/settings")).json();
const scriptId = scripts.scripts?.[0]?.id || null;
// No real run? Use a syntactically valid id that resolves to "Run not found" —
// the shell still renders, which is all the nav check needs. Never start a run
// here; that would dial live leads.
const realRun = home.runs?.[0]?.id || null;
const runId = realRun || "00000000-0000-0000-0000-000000000000";
console.log(`\n  sample run id    : ${realRun || `${runId} (synthetic — tenant has no runs)`}`);
console.log(`  sample script id : ${scriptId || "(none)"}`);
console.log(`  tenant number set: ${settings.number ? "yes" : "NO — wa link will stay generic"}\n`);

const pages = [
  ["home", ""],
  ["journey", "/how-it-works"],
  ["scripts", "/scripts"],
  ["runs/new", "/runs/new"],
  ["knowledge", "/kb"],
  ["settings", "/settings"],
  ["join", "/join"],
];
if (scriptId) pages.push(["script editor", `/scripts/${scriptId}`]);
pages.push(["run results", `/runs/${runId}`]);

console.log("SCREENS");
const html = {};
for (const [label, suffix] of pages) {
  const path = `/copilot/${encodeURIComponent(tenant)}${suffix}`;
  const t0 = Date.now();
  const res = await get(path);
  const body = await res.text();
  html[label] = body;
  const ms = Date.now() - t0;
  const flags = [];
  if (!res.ok) flags.push(`STATUS ${res.status}`);
  if (/Application error|Unhandled Runtime Error|__next_error__/.test(body)) {
    flags.push("RUNTIME ERROR");
  }
  if (/Internal Server Error/.test(body)) flags.push("500");
  console.log(
    `  ${String(res.status).padEnd(4)} ${String(ms).padStart(5)}ms  ${label.padEnd(
      14
    )} ${flags.length ? flags.join(" ") : "ok"}`
  );
}

console.log("\nFIX CHECKS");

// The active tab carries bg-az; pull the label out of each nav anchor.
function activeTabs(body) {
  const tabs = [];
  const re = /<a[^>]*class="([^"]*rounded-lg px-3\.5[^"]*)"[^>]*>([^<]*)<\/a>/g;
  let m;
  while ((m = re.exec(body))) {
    if (/bg-az\b/.test(m[1])) tabs.push(m[2].trim());
  }
  return tabs;
}

function report(label, tabs, expected) {
  const pass = tabs.includes(expected);
  console.log(
    `  ${label.padEnd(23)}: active=[${tabs.join(",") || "none"}] ${pass ? "PASS" : "FAIL"}`
  );
}

report("run results nav", activeTabs(html["run results"]), "Runs");
report("runs/new nav", activeTabs(html["runs/new"]), "Runs");
if (scriptId) report("script editor nav", activeTabs(html["script editor"]), "Scripts");

for (const label of ["scripts", "knowledge", "runs/new", "journey"]) {
  const bare = /href="https:\/\/wa\.me\/"/.test(html[label]);
  console.log(
    `  ${label.padEnd(23)}: bare wa.me on first paint ${bare ? "yes (resolves client-side)" : "no"}`
  );
}

console.log(
  `  join wizard logout     : ${/LOG OUT/.test(html.join) ? "PASS" : "FAIL"}`
);

const preview = await fetch(`${ORIGIN}/api/console/runs/preview`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ source_type: "segment", list_name: "" }),
});
const previewBody = await preview.json();
console.log(
  `  unnamed segment preview: API returns matched=${previewBody.matched} (UI no longer asks)`
);
console.log(
  `  builder gate copy      : ${/Pick a (saved )?list/.test(html["runs/new"]) ? "PASS" : "FAIL"}`
);

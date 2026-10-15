/**
 * Runs migration 028 against a disposable local Postgres container.
 * Does not use production Supabase.
 *
 * node scripts/qa-jarvis-lease-postgres.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER = "jarvis-lease-pg-028";
const T = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const PHONE = "971500000099";
const OTHER = "971500000098";
const TOKEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TURN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function exec(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error((err || out).trim()));
      else resolve(out.trim());
    });
    child.stdin.end(input || "");
  });
}

function psql(sql) {
  return exec(
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
  );
}

function acquire(token, phone = PHONE, seconds = 150) {
  return psql(
    `select coalesce(acquire_jarvis_conversation_lock('${T}'::uuid, '${A}'::uuid, '${phone}', '${token}'::uuid, ${seconds})::text, 'none');`
  );
}

async function main() {
  await exec(["rm", "-f", CONTAINER]).catch(() => {});
  await exec([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "postgres:16",
  ]);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await psql("select 1");
      break;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  await psql(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end $$;
    create table tenants (id uuid primary key);
    create table agents (id uuid primary key);
    insert into tenants (id) values ('${T}');
    insert into agents (id) values ('${A}');
  `);
  const migration = readFileSync(
    join(ROOT, "supabase/migrations/028_jarvis_conversation.sql"),
    "utf8"
  );
  await exec(
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    migration
  );
  console.log("\nMIGRATION APPLIED LOCALLY");

  const [first, second] = await Promise.all([acquire(TOKEN_A), acquire(TOKEN_B)]);
  const winners = [first, second].filter((value) => value !== "none");
  check("concurrent acquire returns exactly one token", winners.length === 1, `${first} | ${second}`);
  const lockCount = await psql(
    `select count(*)::text from jarvis_conversation_locks where sender_phone = '${PHONE}';`
  );
  check("concurrent acquire creates one lock row", lockCount === "1", lockCount);
  const held = await psql(
    `select lock_token::text from jarvis_conversation_locks where sender_phone = '${PHONE}';`
  );
  check("held token is one of the callers", held === TOKEN_A || held === TOKEN_B, held);

  const loser = held === TOKEN_A ? TOKEN_B : TOKEN_A;
  const liveAttempt = await acquire(TOKEN_D);
  check("live lock is not replaced", liveAttempt === "none" && (await psql(
    `select lock_token::text from jarvis_conversation_locks where sender_phone = '${PHONE}';`
  )) === held);

  const oldExtend = await psql(
    `select coalesce(extend_jarvis_conversation_lock('${T}'::uuid, '${A}'::uuid, '${PHONE}', '${loser}'::uuid, 150)::text, 'none');`
  );
  check("old token cannot extend", oldExtend === "none");
  const oldRelease = await psql(
    `select release_jarvis_conversation_lock('${T}'::uuid, '${A}'::uuid, '${PHONE}', '${loser}'::uuid);`
  );
  check(
    "old token cannot release",
    oldRelease === "f" &&
      (await psql(
        `select lock_token::text from jarvis_conversation_locks where sender_phone = '${PHONE}';`
      )) === held
  );

  const staleInsert = await psql(
    `select coalesce(insert_jarvis_assistant_if_owner('${T}'::uuid, '${A}'::uuid, '${PHONE}', '${loser}'::uuid, '${TURN}'::uuid, 'stale assistant')::text, 'none');`
  );
  const staleCount = await psql("select count(*)::text from jarvis_conversation_messages;");
  check("old token cannot insert an assistant row", staleInsert === "none" && staleCount === "0", staleInsert);

  const other = await acquire(TOKEN_D, OTHER);
  const locksWhileBusy = await psql("select count(*)::text from jarvis_conversation_locks;");
  check("another sender acquires while the first lease is live", other === TOKEN_D && locksWhileBusy === "2", other);
  await psql(
    `select release_jarvis_conversation_lock('${T}'::uuid, '${A}'::uuid, '${OTHER}', '${TOKEN_D}'::uuid);`
  );

  await psql(
    `update jarvis_conversation_locks set locked_until = now() - interval '5 seconds' where sender_phone = '${PHONE}';`
  );
  const takeover = await acquire(TOKEN_C);
  check("expired lease can be taken over", takeover === TOKEN_C, takeover);

  const inserted = await psql(
    `select insert_jarvis_assistant_if_owner('${T}'::uuid, '${A}'::uuid, '${PHONE}', '${TOKEN_C}'::uuid, '${TURN}'::uuid, 'owned assistant')::text;`
  );
  const again = await psql(
    `select insert_jarvis_assistant_if_owner('${T}'::uuid, '${A}'::uuid, '${PHONE}', '${TOKEN_C}'::uuid, '${TURN}'::uuid, 'second assistant')::text;`
  );
  const bodies = await psql(
    "select count(*)::text || ' ' || min(body) from jarvis_conversation_messages where role = 'assistant';"
  );
  check("owner inserts one assistant row", inserted === again && bodies === "1 owned assistant", bodies);

  const staleClaim = await psql(
    `select mark_jarvis_assistant_sent_if_owner('${T}'::uuid, '${A}'::uuid, '${PHONE}', '${held}'::uuid, '${inserted}'::uuid);`
  );
  const ownerClaim = await psql(
    `select mark_jarvis_assistant_sent_if_owner('${T}'::uuid, '${A}'::uuid, '${PHONE}', '${TOKEN_C}'::uuid, '${inserted}'::uuid);`
  );
  const secondClaim = await psql(
    `select mark_jarvis_assistant_sent_if_owner('${T}'::uuid, '${A}'::uuid, '${PHONE}', '${TOKEN_C}'::uuid, '${inserted}'::uuid);`
  );
  check("only the current owner can mark the assistant sent", staleClaim === "f" && ownerClaim === "t" && secondClaim === "f");

  let rejected = false;
  try {
    await acquire(TOKEN_D, "971500000097", 181);
  } catch (error) {
    rejected = /lease seconds out of range/.test(error.message);
  }
  check("lease longer than 180 seconds is rejected", rejected);

  const ownerRelease = await psql(
    `select release_jarvis_conversation_lock('${T}'::uuid, '${A}'::uuid, '${PHONE}', '${TOKEN_C}'::uuid);`
  );
  const left = await psql(
    `select count(*)::text from jarvis_conversation_locks where sender_phone = '${PHONE}';`
  );
  check("current owner can release", ownerRelease === "t" && left === "0");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failures += 1;
} finally {
  await exec(["rm", "-f", CONTAINER]).catch(() => {});
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nPostgres lease checks passed.");

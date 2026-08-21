import fs from "fs";
import path from "path";
import pg from "pg";
import { applyEnv, loadEnvFile } from "./load-env.mjs";

applyEnv(loadEnvFile());

function getDatabaseUrl() {
  if (process.env.SUPABASE_DB_URL) {
    return process.env.SUPABASE_DB_URL;
  }

  const password = process.env.SUPABASE_DB_PASSWORD;
  const url = process.env.SUPABASE_URL;

  if (!password || !url) return null;

  const ref = url.replace(/^https?:\/\//, "").split(".")[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.error(
      "Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD (with SUPABASE_URL) to apply migrations."
    );
    process.exit(1);
  }

  const migrationPath = path.resolve(
    process.cwd(),
    process.argv[2] || "supabase/migrations/001_whatsapp.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);
    console.log("Migration applied:", migrationPath);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});

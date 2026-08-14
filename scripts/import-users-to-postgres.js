import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const usersFile = join(rootDir, "data", "users.json");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL before running this import.");
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false }
});

const raw = await readFile(usersFile, "utf-8");
const store = JSON.parse(raw);

if (!Array.isArray(store.users)) {
  console.error("data/users.json does not contain a users array.");
  process.exit(1);
}

await pool.query(`
  CREATE TABLE IF NOT EXISTS dap_users (
    username TEXT PRIMARY KEY,
    username_key TEXT UNIQUE NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    orcid TEXT NOT NULL DEFAULT '',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    favorites JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

for (const user of store.users) {
  await pool.query(`
    INSERT INTO dap_users (
      username,
      username_key,
      password_salt,
      password_hash,
      full_name,
      orcid,
      is_admin,
      favorites,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, COALESCE($9::timestamptz, NOW()))
    ON CONFLICT (username_key) DO UPDATE SET
      username = EXCLUDED.username,
      password_salt = EXCLUDED.password_salt,
      password_hash = EXCLUDED.password_hash,
      full_name = EXCLUDED.full_name,
      orcid = EXCLUDED.orcid,
      is_admin = EXCLUDED.is_admin,
      favorites = EXCLUDED.favorites
  `, [
    user.username,
    user.usernameKey,
    user.passwordSalt,
    user.passwordHash,
    user.fullName || "",
    user.orcid || "",
    Boolean(user.isAdmin),
    JSON.stringify(Array.isArray(user.favorites) ? user.favorites : []),
    user.createdAt || null
  ]);
}

await pool.end();
console.log(`Imported ${store.users.length} users into Postgres.`);

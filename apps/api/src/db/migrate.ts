import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadEnvFileIfPresent } from "../config/env.js";
import { createDbConnection, type Database } from "./client.js";
import { applyTenantRlsAndViews } from "./rls.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(
  db: Database,
  migrationsFolder = resolve(__dirname, "../../drizzle")
): Promise<void> {
  await migrate(db, { migrationsFolder });
  await applyTenantRlsAndViews(db);
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  loadEnvFileIfPresent();
  const { pool, db } = createDbConnection();
  try {
    await runMigrations(db);
    console.log("[db:migrate] Migraciones, RLS y vistas aplicadas con éxito.");
  } finally {
    await pool.end();
  }
}

import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type DbExecutor = Database | DbTransaction;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertValidTenantId(tenantId: string): string {
  const clean = tenantId.trim();
  if (!UUID_REGEX.test(clean)) {
    throw new Error(`tenantId inválido o ausente: '${tenantId}'`);
  }
  return clean;
}

export interface DbConnection {
  pool: Pool;
  db: Database;
}

export function resolveDatabaseUrl(explicitUrl?: string): string {
  const url = (explicitUrl ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL no está configurada. Define la conexión PostgreSQL en .env o entorno."
    );
  }
  return url;
}

export function createDbConnection(explicitUrl?: string): DbConnection {
  const pool = new Pool({
    connectionString: resolveDatabaseUrl(explicitUrl),
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

/**
 * Ejecuta una operación dentro de una transacción PostgreSQL con contexto RLS por tenant.
 */
export async function withTenantTransaction<T>(
  db: Database,
  tenantId: string,
  fn: (tx: DbTransaction, validTenantId: string) => Promise<T>
): Promise<T> {
  const validTenantId = assertValidTenantId(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${validTenantId}, true)`
    );
    return fn(tx, validTenantId);
  });
}

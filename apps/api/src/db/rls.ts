import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

export const TENANT_STRICT_RLS_TABLES = [
  "tenant_settings",
  "webhooks",
  "users",
  "login_attempts",
  "products",
  "stock_movements",
  "dispatches",
  "dispatch_items",
  "physical_inventories",
  "physical_inventory_items",
  "admin_notifications",
  "customers",
  "shift_closures",
  "market_closures",
  "orders",
  "order_items",
  "order_locks",
  "processed_transactions",
  "full_plans",
  "full_plan_items",
  "factory_plans",
  "factory_plan_items",
  "factory_partial_closures",
  "audit_logs",
  "chat_messages",
  "chat_message_reads",
  "stored_files",
] as const;

/**
 * Aplica políticas Row-Level Security (RLS) multi-tenant y la vista de análisis de reposición.
 * Es idempotente y segura de re-ejecutar tras cada migración.
 */
export async function applyTenantRlsAndViews(db: Database): Promise<void> {
  for (const table of TENANT_STRICT_RLS_TABLES) {
    const policyName = `tenant_isolation_${table}`;
    await db.execute(
      sql.raw(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`)
    );
    await db.execute(
      sql.raw(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`)
    );
    await db.execute(
      sql.raw(`DROP POLICY IF EXISTS "${policyName}" ON "${table}";`)
    );
    await db.execute(
      sql.raw(`
        CREATE POLICY "${policyName}" ON "${table}"
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
      `)
    );
  }

  // En api_sessions y api_keys habilitamos RLS cuando app.current_tenant_id está presente,
  // permitiendo la resolución inicial de credenciales por token_hash / key_hash.
  for (const authTable of ["api_sessions", "api_keys"] as const) {
    const policyName = `tenant_isolation_${authTable}`;
    await db.execute(
      sql.raw(`ALTER TABLE "${authTable}" ENABLE ROW LEVEL SECURITY;`)
    );
    await db.execute(
      sql.raw(`DROP POLICY IF EXISTS "${policyName}" ON "${authTable}";`)
    );
    await db.execute(
      sql.raw(`
        CREATE POLICY "${policyName}" ON "${authTable}"
        USING (
          NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
          OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
        WITH CHECK (
          tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        );
      `)
    );
  }

  await db.execute(
    sql.raw(`
      CREATE OR REPLACE VIEW v_analisis_reposicion AS
      SELECT
        p.id,
        p.tenant_id,
        p.code,
        p.name,
        p.stock,
        p.stock_minimo,
        p.stock_maximo,
        p.ubicacion,
        CASE
          WHEN p.stock <= 0 THEN 'AGOTADO'
          WHEN p.stock <= p.stock_minimo THEN 'QUIEBRE_INMINENTE'
          WHEN p.stock > p.stock_maximo THEN 'SOBRESTOCK'
          ELSE 'OPTIMO'
        END AS estado_inventario,
        CASE
          WHEN p.stock <= p.stock_minimo THEN GREATEST(0, p.stock_maximo - p.stock)
          ELSE 0
        END AS cantidad_sugerida_pedir
      FROM products p
      WHERE p.active = true;
    `)
  );
}

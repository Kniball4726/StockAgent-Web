import { eq, sql } from "drizzle-orm";
import { withTenantTransaction, type Database } from "../../db/client.js";
import {
  auditLogs,
  products,
  tenants,
  users,
} from "../../db/schema/index.js";
import type {
  LegacyMigrationReport,
  LegacyProductSeed,
  LegacyUserSeed,
} from "./types.js";

export async function importLegacyDatasetToTenant(params: {
  db: Database;
  tenantSlug: string;
  products: LegacyProductSeed[];
  users?: LegacyUserSeed[];
  dryRun?: boolean;
  overwriteExistingStock?: boolean;
  initialWarnings?: string[];
}): Promise<LegacyMigrationReport> {
  const dryRun = params.dryRun ?? true;
  const legacyUsers = params.users ?? [];
  const warnings = [...(params.initialWarnings ?? [])];

  const [tenant] = await params.db
    .select()
    .from(tenants)
    .where(sql`lower(${tenants.slug}) = lower(${params.tenantSlug})`)
    .limit(1);

  if (!tenant) {
    throw new Error(`Tenant '${params.tenantSlug}' no encontrado.`);
  }

  let productsInserted = 0;
  let productsUpdated = 0;
  let usersInserted = 0;
  let usersSkipped = 0;

  await withTenantTransaction(
    params.db,
    tenant.id,
    async (tx, validTenantId) => {
      const existingProductsRows = await tx
        .select({ id: products.id, code: products.code })
        .from(products)
        .where(eq(products.tenantId, validTenantId));
      const productByCodeLower = new Map<string, number>();
      for (const row of existingProductsRows) {
        productByCodeLower.set(row.code.toLowerCase(), row.id);
      }

      for (const item of params.products) {
        const existingId = productByCodeLower.get(item.code.toLowerCase());
        if (existingId === undefined) {
          productsInserted += 1;
          if (!dryRun) {
            await tx.insert(products).values({
              tenantId: validTenantId,
              code: item.code,
              name: item.name,
              stock: item.stock,
              stockFisico: item.stock,
              stockMinimo: item.stockMinimo,
              stockMaximo: item.stockMaximo,
              codBarras: item.codBarras,
              ubicacion: item.ubicacion,
              active: true,
            });
          }
          productByCodeLower.set(item.code.toLowerCase(), -1);
        } else if (params.overwriteExistingStock && existingId > 0) {
          productsUpdated += 1;
          if (!dryRun) {
            await tx
              .update(products)
              .set({
                name: item.name,
                stock: item.stock,
                stockFisico: item.stock,
                stockMinimo: item.stockMinimo,
                stockMaximo: item.stockMaximo,
                ...(item.codBarras ? { codBarras: item.codBarras } : {}),
                ...(item.ubicacion ? { ubicacion: item.ubicacion } : {}),
                updatedAt: new Date(),
              })
              .where(eq(products.id, existingId));
          }
        }
      }

      const existingUserRows = await tx
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.tenantId, validTenantId));
      const existingUsernamesLower = new Set<string>(
        existingUserRows.map((u) => u.username.toLowerCase())
      );

      for (const usr of legacyUsers) {
        if (existingUsernamesLower.has(usr.username.toLowerCase())) {
          usersSkipped += 1;
          continue;
        }

        usersInserted += 1;
        existingUsernamesLower.add(usr.username.toLowerCase());
        if (!dryRun) {
          await tx.insert(users).values({
            tenantId: validTenantId,
            username: usr.username,
            passwordHash: usr.passwordHash,
            role: usr.role,
            active: usr.active,
            mustChangePassword: false,
            nombre: usr.nombre,
            email: usr.email,
          });
        }
      }

      if (!dryRun) {
        await tx.insert(auditLogs).values({
          tenantId: validTenantId,
          usuario: "cli:migrate-legacy",
          accion: "LEGACY_MIGRATION_IMPORT",
          detalle: `Productos +${productsInserted}/upd=${productsUpdated}, Usuarios +${usersInserted}/skip=${usersSkipped}`,
        });
      }
    }
  );

  return {
    tenantSlug: tenant.slug,
    dryRun,
    productsParsed: params.products.length,
    productsInserted,
    productsUpdated,
    usersParsed: legacyUsers.length,
    usersInserted,
    usersSkipped,
    warnings,
  };
}

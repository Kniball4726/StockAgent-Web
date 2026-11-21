import { and, eq, sql } from "drizzle-orm";
import {
  getTenantPlanQuota,
  type ProvisionTenantRequest,
  type TenantPlan,
  type TenantPlanQuota,
  type UpdateTenantRequest,
} from "@stockagent/shared";
import { withTenantTransaction, type Database } from "../db/client.js";
import {
  products,
  storedFiles,
  tenantSettings,
  tenants,
  users,
} from "../db/schema/index.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../repositories/base.js";
import { hashPassword } from "../security/crypto.js";

export interface TenantOverviewRecord {
  id: string;
  slug: string;
  name: string;
  plan: TenantPlan;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantUsageSummary {
  tenant: TenantOverviewRecord;
  quotas: TenantPlanQuota;
  usage: {
    usersCount: number;
    productsCount: number;
    storageBytes: number;
  };
  withinLimits: boolean;
}

export class TenantAdminService {
  constructor(private readonly db: Database) {}

  async listTenants(): Promise<TenantOverviewRecord[]> {
    return this.db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        plan: tenants.plan,
        active: tenants.active,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
      })
      .from(tenants)
      .orderBy(tenants.createdAt);
  }

  async provisionTenant(input: ProvisionTenantRequest): Promise<{
    tenant: TenantOverviewRecord;
    adminUser: { id: number; username: string; role: "administrador" };
  }> {
    const cleanSlug = input.slug.trim().toLowerCase();
    const [existing] = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(sql`lower(${tenants.slug}) = lower(${cleanSlug})`)
      .limit(1);

    if (existing) {
      throw new ConflictError(`Ya existe un tenant con el slug '${cleanSlug}'.`);
    }

    const [createdTenant] = await this.db
      .insert(tenants)
      .values({
        slug: cleanSlug,
        name: input.name.trim(),
        plan: input.plan,
        active: true,
      })
      .returning();

    if (!createdTenant) {
      throw new Error("No se pudo registrar el tenant.");
    }

    const adminHash = hashPassword(input.adminPassword);

    const adminUser = await withTenantTransaction(
      this.db,
      createdTenant.id,
      async (tx, tenantId) => {
        await tx
          .insert(tenantSettings)
          .values({ tenantId })
          .onConflictDoNothing();

        const [userRow] = await tx
          .insert(users)
          .values({
            tenantId,
            username: input.adminUsername.trim(),
            passwordHash: adminHash,
            role: "administrador",
            active: true,
            mustChangePassword: false,
            nombre: input.adminNombre.trim() || "Administrador",
            email: input.adminEmail.trim(),
          })
          .returning({
            id: users.id,
            username: users.username,
          });

        if (!userRow) {
          throw new Error("No se pudo crear el usuario administrador inicial.");
        }

        return {
          id: userRow.id,
          username: userRow.username,
          role: "administrador" as const,
        };
      }
    );

    return {
      tenant: {
        id: createdTenant.id,
        slug: createdTenant.slug,
        name: createdTenant.name,
        plan: createdTenant.plan,
        active: createdTenant.active,
        createdAt: createdTenant.createdAt,
        updatedAt: createdTenant.updatedAt,
      },
      adminUser,
    };
  }

  async updateTenant(
    tenantId: string,
    patch: UpdateTenantRequest
  ): Promise<TenantOverviewRecord> {
    const [existing] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!existing) {
      throw new NotFoundError("Tenant no encontrado.");
    }

    const [updated] = await this.db
      .update(tenants)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    if (!updated) {
      throw new NotFoundError("Tenant no encontrado.");
    }

    return updated;
  }

  async getTenantUsage(tenantId: string): Promise<TenantUsageSummary> {
    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      throw new NotFoundError("Tenant no encontrado.");
    }

    const usage = await withTenantTransaction(
      this.db,
      tenant.id,
      async (tx, validTenantId) => {
        const [uCountRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.tenantId, validTenantId), eq(users.active, true)));

        const [pCountRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(products)
          .where(and(eq(products.tenantId, validTenantId), eq(products.active, true)));

        const [fSumRow] = await tx
          .select({
            bytes: sql<number>`coalesce(sum(${storedFiles.sizeBytes}), 0)::bigint`,
          })
          .from(storedFiles)
          .where(eq(storedFiles.tenantId, validTenantId));

        return {
          usersCount: Number(uCountRow?.count ?? 0),
          productsCount: Number(pCountRow?.count ?? 0),
          storageBytes: Number(fSumRow?.bytes ?? 0),
        };
      }
    );

    const quotas = getTenantPlanQuota(tenant.plan);
    const withinLimits =
      usage.usersCount <= quotas.maxUsers &&
      usage.productsCount <= quotas.maxProducts &&
      usage.storageBytes <= quotas.maxStorageBytes;

    return {
      tenant,
      quotas,
      usage,
      withinLimits,
    };
  }

  async assertQuotaForNewResource(
    tenantId: string,
    resource: "user" | "product" | "storage",
    additionalBytes = 0
  ): Promise<void> {
    const summary = await this.getTenantUsage(tenantId);
    if (!summary.tenant.active) {
      throw new ForbiddenError("El tenant está suspendido.");
    }

    if (
      resource === "user" &&
      summary.usage.usersCount + 1 > summary.quotas.maxUsers
    ) {
      throw new ForbiddenError(
        `Límite de usuarios alcanzado para el plan '${summary.quotas.plan}' (${summary.quotas.maxUsers}).`
      );
    }

    if (
      resource === "product" &&
      summary.usage.productsCount + 1 > summary.quotas.maxProducts
    ) {
      throw new ForbiddenError(
        `Límite de productos alcanzado para el plan '${summary.quotas.plan}' (${summary.quotas.maxProducts}).`
      );
    }

    if (
      resource === "storage" &&
      summary.usage.storageBytes + additionalBytes > summary.quotas.maxStorageBytes
    ) {
      throw new ForbiddenError(
        `Cuota de almacenamiento superada para el plan '${summary.quotas.plan}'.`
      );
    }
  }
}

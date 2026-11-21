import { eq, sql } from "drizzle-orm";
import type { TenantPlan } from "@stockagent/shared";
import { assertValidTenantId, type Database } from "../../db/client.js";
import { tenants, tenantSettings } from "../../db/schema/index.js";
import { ConflictError } from "../base.js";

export class TenantRepository {
  constructor(private readonly db: Database) {}

  async getTenantBySlug(slug: string) {
    const clean = slug.trim();
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(sql`lower(${tenants.slug}) = lower(${clean})`)
      .limit(1);
    return row ?? null;
  }

  async getTenantById(tenantId: string) {
    const valid = assertValidTenantId(tenantId);
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, valid))
      .limit(1);
    return row ?? null;
  }

  async createTenant(input: {
    slug: string;
    name: string;
    plan?: TenantPlan | undefined;
  }) {
    const slug = input.slug.trim().toLowerCase();
    const name = input.name.trim();
    if (!slug || !name) {
      throw new ConflictError("El slug y el nombre del tenant son obligatorios.");
    }

    const existing = await this.getTenantBySlug(slug);
    if (existing) {
      throw new ConflictError(`Ya existe un tenant con slug '${slug}'.`);
    }

    const [created] = await this.db
      .insert(tenants)
      .values({
        slug,
        name,
        plan: input.plan ?? "free",
        active: true,
      })
      .returning();

    if (!created) {
      throw new Error("No se pudo crear el tenant.");
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${created.id}, true)`
      );
      await tx
        .insert(tenantSettings)
        .values({ tenantId: created.id })
        .onConflictDoNothing();
    });

    return created;
  }
}

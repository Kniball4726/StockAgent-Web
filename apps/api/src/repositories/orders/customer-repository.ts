import { and, asc, eq, sql } from "drizzle-orm";
import { auditLogs, customers } from "../../db/schema/index.js";
import { ConflictError, runInTenantTx, type TenantScope } from "../base.js";

export type CustomerRecord = typeof customers.$inferSelect;

export class CustomerRepository {
  async listCustomers(scope: TenantScope): Promise<CustomerRecord[]> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      return tx
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.activo, true)))
        .orderBy(asc(customers.nombre));
    });
  }

  async createOrReactivateCustomer(
    scope: TenantScope,
    input: {
      nombre: string;
      codigo?: string | undefined;
      direccion?: string | undefined;
      usuario?: string | undefined;
    }
  ): Promise<CustomerRecord> {
    const nombre = input.nombre.trim();
    const codigo = (input.codigo ?? "").trim();
    const direccion = (input.direccion ?? "").trim();
    if (!nombre) {
      throw new ConflictError("El nombre del cliente no puede estar vacío.");
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const [existing] = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.tenantId, tenantId),
            sql`lower(${customers.nombre}) = lower(${nombre})`
          )
        )
        .limit(1);

      if (existing) {
        if (existing.activo) {
          throw new ConflictError(`El cliente '${nombre}' ya existe.`);
        }
        const [reactivated] = await tx
          .update(customers)
          .set({
            activo: true,
            nombre,
            codigo: codigo || existing.codigo,
            direccion: direccion || existing.direccion,
          })
          .where(
            and(eq(customers.tenantId, tenantId), eq(customers.id, existing.id))
          )
          .returning();
        if (!reactivated) {
          throw new Error("No se pudo reactivar el cliente.");
        }
        return reactivated;
      }

      const [created] = await tx
        .insert(customers)
        .values({
          tenantId,
          nombre,
          codigo,
          direccion,
          activo: true,
        })
        .returning();
      if (!created) {
        throw new Error("No se pudo crear el cliente.");
      }

      let result = created;
      if (!codigo) {
        const autoCode = `CLI-${String(created.id).padStart(6, "0")}`;
        const [withCode] = await tx
          .update(customers)
          .set({ codigo: autoCode })
          .where(
            and(eq(customers.tenantId, tenantId), eq(customers.id, created.id))
          )
          .returning();
        if (withCode) {
          result = withCode;
        }
      }

      await tx.insert(auditLogs).values({
        tenantId,
        usuario: input.usuario ?? "sistema",
        accion: "CREAR_CLIENTE",
        detalle: `Cliente '${result.nombre}' (${result.codigo}) registrado.`,
      });

      return result;
    });
  }
}

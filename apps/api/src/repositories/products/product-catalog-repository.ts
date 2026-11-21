import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import {
  coincideCodigoOBarras,
  generarVariantesCodigoLector,
  normalizarCodigo,
} from "@stockagent/shared";
import { products, stockMovements } from "../../db/schema/index.js";
import {
  ConflictError,
  NotFoundError,
  runInTenantTx,
  type TenantScope,
} from "../base.js";

export type ProductRecord = typeof products.$inferSelect;

export class ProductCatalogRepository {
  async listProducts(
    scope: TenantScope,
    onlyActive = true
  ): Promise<ProductRecord[]> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const whereClause = onlyActive
        ? and(eq(products.tenantId, tenantId), eq(products.active, true))
        : eq(products.tenantId, tenantId);
      return tx
        .select()
        .from(products)
        .where(whereClause)
        .orderBy(asc(products.displayOrder), asc(products.id));
    });
  }

  async searchProducts(
    scope: TenantScope,
    term: string,
    limit = 50
  ): Promise<ProductRecord[]> {
    const clean = term.trim();
    if (!clean) {
      return (await this.listProducts(scope, true)).slice(0, limit);
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const pattern = `%${clean}%`;
      return tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantId),
            eq(products.active, true),
            or(
              ilike(products.code, pattern),
              ilike(products.name, pattern),
              ilike(products.codBarras, pattern)
            )
          )
        )
        .orderBy(asc(products.displayOrder), asc(products.id))
        .limit(limit);
    });
  }

  async findProductByCodeOrBarcode(
    scope: TenantScope,
    rawQuery: string
  ): Promise<ProductRecord | null> {
    const variants = generarVariantesCodigoLector(rawQuery);
    if (variants.length === 0) {
      return null;
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const rows = await tx
        .select()
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.active, true)));

      for (const variant of variants) {
        const exact = rows.find(
          (r) =>
            r.code.toLowerCase() === variant.toLowerCase() ||
            r.codBarras.toLowerCase() === variant.toLowerCase()
        );
        if (exact) {
          return exact;
        }
      }
      return rows.find((r) => coincideCodigoOBarras(r, rawQuery)) ?? null;
    });
  }

  async createOrUpdateProduct(
    scope: TenantScope,
    input: {
      code: string;
      name: string;
      stock?: number | undefined;
      stockMinimo?: number | undefined;
      stockMaximo?: number | undefined;
      codBarras?: string | undefined;
      ubicacion?: string | undefined;
      displayOrder?: number | undefined;
      active?: boolean | undefined;
      usuario?: string | undefined;
    }
  ): Promise<ProductRecord> {
    const code = normalizarCodigo(input.code);
    const name = input.name.trim();
    if (!code || !name) {
      throw new ConflictError(
        "El código y el nombre del producto son obligatorios."
      );
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const [existing] = await tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantId),
            sql`lower(${products.code}) = lower(${code})`
          )
        )
        .limit(1);

      if (!existing) {
        const [created] = await tx
          .insert(products)
          .values({
            tenantId,
            code,
            name,
            stock: input.stock ?? 0,
            stockMinimo: input.stockMinimo ?? 5,
            stockMaximo: input.stockMaximo ?? 100,
            codBarras: (input.codBarras ?? "").trim(),
            ubicacion: (input.ubicacion ?? "").trim().toUpperCase(),
            displayOrder: input.displayOrder ?? 0,
            active: input.active ?? true,
          })
          .returning();
        if (!created) {
          throw new Error("No se pudo insertar el producto.");
        }
        if (created.stock !== 0) {
          await tx.insert(stockMovements).values({
            tenantId,
            productId: created.id,
            productCode: created.code,
            productName: created.name,
            quantity: created.stock,
            movementType:
              created.stock > 0 ? "ingreso_fabrica" : "ajuste_manual",
            usuario: input.usuario ?? "sistema",
            detalle: "Alta de producto con stock inicial",
          });
        }
        return created;
      }

      const nextStock = input.stock ?? existing.stock;
      const delta = nextStock - existing.stock;
      const [updated] = await tx
        .update(products)
        .set({
          code,
          name,
          stock: nextStock,
          stockMinimo: input.stockMinimo ?? existing.stockMinimo,
          stockMaximo: input.stockMaximo ?? existing.stockMaximo,
          codBarras:
            input.codBarras !== undefined
              ? input.codBarras.trim()
              : existing.codBarras,
          ubicacion:
            input.ubicacion !== undefined
              ? input.ubicacion.trim().toUpperCase()
              : existing.ubicacion,
          displayOrder: input.displayOrder ?? existing.displayOrder,
          active: input.active ?? existing.active,
          updatedAt: new Date(),
        })
        .where(
          and(eq(products.tenantId, tenantId), eq(products.id, existing.id))
        )
        .returning();

      if (!updated) {
        throw new Error("No se pudo actualizar el producto.");
      }

      if (delta !== 0) {
        await tx.insert(stockMovements).values({
          tenantId,
          productId: updated.id,
          productCode: updated.code,
          productName: updated.name,
          quantity: delta,
          movementType: "ajuste_manual",
          usuario: input.usuario ?? "sistema",
          detalle: "Edición de producto",
        });
      }

      return updated;
    });
  }

  async updateLocation(
    scope: TenantScope,
    code: string,
    ubicacion: string
  ): Promise<ProductRecord> {
    const cleanCode = normalizarCodigo(code);
    const cleanUbic = ubicacion.trim().toUpperCase();
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [updated] = await tx
        .update(products)
        .set({ ubicacion: cleanUbic, updatedAt: new Date() })
        .where(
          and(
            eq(products.tenantId, tenantId),
            sql`lower(${products.code}) = lower(${cleanCode})`
          )
        )
        .returning();
      if (!updated) {
        throw new NotFoundError(`Producto '${cleanCode}' no encontrado.`);
      }
      return updated;
    });
  }

  async setBarcode(
    scope: TenantScope,
    code: string,
    codBarras: string
  ): Promise<ProductRecord> {
    const cleanCode = normalizarCodigo(code);
    const cleanBarcode = codBarras.trim();
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [updated] = await tx
        .update(products)
        .set({ codBarras: cleanBarcode, updatedAt: new Date() })
        .where(
          and(
            eq(products.tenantId, tenantId),
            sql`lower(${products.code}) = lower(${cleanCode})`
          )
        )
        .returning();
      if (!updated) {
        throw new NotFoundError(`Producto '${cleanCode}' no encontrado.`);
      }
      return updated;
    });
  }
}

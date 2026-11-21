import { and, asc, desc, eq, ilike, lte, or, sql } from "drizzle-orm";
import {
  coincideCodigoOBarras,
  generarVariantesCodigoLector,
  normalizarCodigo,
  type InventoryHealthState,
  type MovementType,
} from "@stockagent/shared";
import {
  adminNotifications,
  dispatchItems,
  dispatches,
  physicalInventories,
  physicalInventoryItems,
  products,
  stockMovements,
} from "../db/schema/index.js";
import { ConflictError, NotFoundError, runInTenantTx, type TenantScope } from "./base.js";

export type ProductRecord = typeof products.$inferSelect;

export interface BatchDiscountEntry {
  codigo: string;
  cantidad: number;
}

export interface ReplenishmentItem {
  id: number;
  code: string;
  name: string;
  stock: number;
  stockMinimo: number;
  stockMaximo: number;
  ubicacion: string;
  estadoInventario: InventoryHealthState;
  cantidadSugeridaPedir: number;
}

export class ProductRepository {
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
      throw new ConflictError("El código y el nombre del producto son obligatorios.");
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
            movementType: created.stock > 0 ? "ingreso_fabrica" : "ajuste_manual",
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
        .where(and(eq(products.tenantId, tenantId), eq(products.id, existing.id)))
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

  async adjustStockAtomic(
    scope: TenantScope,
    input: {
      codigo: string;
      delta: number;
      movementType: MovementType;
      usuario: string;
      detalle?: string | undefined;
    }
  ) {
    const code = normalizarCodigo(input.codigo);
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [prod] = await tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantId),
            sql`lower(${products.code}) = lower(${code})`
          )
        )
        .limit(1);

      if (!prod) {
        throw new NotFoundError(`El código '${code}' no existe en el catálogo.`);
      }

      const previousStock = prod.stock;
      const newStock = previousStock + input.delta;

      const [updated] = await tx
        .update(products)
        .set({ stock: newStock, updatedAt: new Date() })
        .where(and(eq(products.tenantId, tenantId), eq(products.id, prod.id)))
        .returning();

      if (input.delta !== 0) {
        await tx.insert(stockMovements).values({
          tenantId,
          productId: prod.id,
          productCode: prod.code,
          productName: prod.name,
          quantity: input.delta,
          movementType: input.movementType,
          usuario: input.usuario.trim() || "sistema",
          detalle: (input.detalle ?? "").trim(),
        });
      }

      return {
        product: updated ?? prod,
        stockAnterior: previousStock,
        stockNuevo: newStock,
      };
    });
  }

  async applyBatchDiscounts(
    scope: TenantScope,
    input: {
      tipoOrigen: string;
      nombreArchivo: string;
      usuario: string;
      items: BatchDiscountEntry[];
      reporteArchivo?: string | undefined;
    }
  ) {
    if (input.items.length === 0) {
      return { dispatchId: 0, totalUnidades: 0, detalles: [] };
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const detalles: Array<{
        productId: number;
        codigo: string;
        nombre: string;
        cantidadDescontada: number;
        stockAnterior: number;
        stockNuevo: number;
      }> = [];

      let totalUnidades = 0;

      for (const item of input.items) {
        const cod = normalizarCodigo(item.codigo);
        const qty = Math.trunc(item.cantidad);
        if (!cod || qty <= 0) {
          continue;
        }
        const [prod] = await tx
          .select()
          .from(products)
          .where(
            and(
              eq(products.tenantId, tenantId),
              sql`lower(${products.code}) = lower(${cod})`
            )
          )
          .limit(1);

        if (!prod) {
          throw new NotFoundError(
            `El código '${cod}' no existe en el catálogo del tenant.`
          );
        }

        const stockAnterior = prod.stock;
        const stockNuevo = stockAnterior - qty;

        await tx
          .update(products)
          .set({ stock: stockNuevo, updatedAt: new Date() })
          .where(and(eq(products.tenantId, tenantId), eq(products.id, prod.id)));

        await tx.insert(stockMovements).values({
          tenantId,
          productId: prod.id,
          productCode: prod.code,
          productName: prod.name,
          quantity: -qty,
          movementType: "descuento",
          usuario: input.usuario,
          detalle: `${input.tipoOrigen}: ${input.nombreArchivo}`.slice(0, 120),
        });

        detalles.push({
          productId: prod.id,
          codigo: prod.code,
          nombre: prod.name,
          cantidadDescontada: qty,
          stockAnterior,
          stockNuevo,
        });
        totalUnidades += qty;
      }

      if (detalles.length === 0) {
        return { dispatchId: 0, totalUnidades: 0, detalles: [] };
      }

      const [dispatch] = await tx
        .insert(dispatches)
        .values({
          tenantId,
          tipoOrigen: input.tipoOrigen,
          nombreArchivo: input.nombreArchivo,
          totalArticulos: totalUnidades,
          reporteArchivo: input.reporteArchivo ?? "",
          usuario: input.usuario,
        })
        .returning();

      if (!dispatch) {
        throw new Error("No se pudo registrar la cabecera de despacho.");
      }

      await tx.insert(dispatchItems).values(
        detalles.map((d) => ({
          tenantId,
          dispatchId: dispatch.id,
          productId: d.productId,
          productCode: d.codigo,
          cantidadDescontada: d.cantidadDescontada,
          stockAnterior: d.stockAnterior,
          stockNuevo: d.stockNuevo,
        }))
      );

      if (!["sistema", "administrador", "admin"].includes(input.usuario.toLowerCase())) {
        await tx.insert(adminNotifications).values({
          tenantId,
          title: `Descuento procesado por operario '${input.usuario}'`,
          message: `Se descontaron ${totalUnidades} unidades en ${detalles.length} producto(s) desde ${input.nombreArchivo}.`,
          operatorUsername: input.usuario,
          notificationType: "descuento",
          details: `Origen: ${input.tipoOrigen} | Unidades: ${totalUnidades} | Productos: ${detalles.length}`,
        });
      }

      return { dispatchId: dispatch.id, totalUnidades, detalles };
    });
  }

  async recordPhysicalInventory(
    scope: TenantScope,
    input: {
      usuario: string;
      nombreArchivo: string;
      conteo: Record<string, number>;
      reporteUnificado?: string | undefined;
    }
  ) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const catalog = await tx
        .select()
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.active, true)));

      const byCode = new Map(catalog.map((p) => [p.code.toLowerCase(), p]));
      const items: Array<{
        productId: number | null;
        codigo: string;
        nombre: string;
        stockDigital: number;
        stockFisico: number;
        diferencia: number;
        estado: string;
      }> = [];

      for (const [rawCode, qty] of Object.entries(input.conteo)) {
        const clean = normalizarCodigo(rawCode);
        const prod =
          byCode.get(clean.toLowerCase()) ??
          catalog.find((p) => coincideCodigoOBarras(p, rawCode));
        const stockFisico = Math.max(0, Math.trunc(qty));
        if (!prod) {
          items.push({
            productId: null,
            codigo: clean || rawCode,
            nombre: "Producto no catalogado",
            stockDigital: 0,
            stockFisico,
            diferencia: stockFisico,
            estado: "NO_CATALOGADO",
          });
          continue;
        }
        const diferencia = stockFisico - prod.stock;
        const estado =
          diferencia === 0
            ? "COINCIDE"
            : diferencia < 0
              ? "FALTANTE"
              : "SOBRANTE";

        items.push({
          productId: prod.id,
          codigo: prod.code,
          nombre: prod.name,
          stockDigital: prod.stock,
          stockFisico,
          diferencia,
          estado,
        });

        await tx
          .update(products)
          .set({ stockFisico, updatedAt: new Date() })
          .where(and(eq(products.tenantId, tenantId), eq(products.id, prod.id)));
      }

      const totalDiferencias = items.filter((i) => i.diferencia !== 0).length;

      const [header] = await tx
        .insert(physicalInventories)
        .values({
          tenantId,
          usuario: input.usuario,
          nombreArchivo: input.nombreArchivo,
          reporteUnificado: input.reporteUnificado ?? "",
          totalRelevados: items.length,
          totalDiferencias,
        })
        .returning();

      if (!header) {
        throw new Error("No se pudo registrar la cabecera de inventario físico.");
      }

      if (items.length > 0) {
        await tx.insert(physicalInventoryItems).values(
          items.map((item) => ({
            tenantId,
            inventoryId: header.id,
            productId: item.productId,
            productCode: item.codigo,
            productName: item.nombre,
            stockDigital: item.stockDigital,
            stockFisico: item.stockFisico,
            diferencia: item.diferencia,
            estado: item.estado,
          }))
        );
      }

      return { inventoryId: header.id, items, totalDiferencias };
    });
  }

  async getReplenishmentAnalysis(
    scope: TenantScope,
    onlyCritical = true
  ): Promise<ReplenishmentItem[]> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const whereClause = onlyCritical
        ? and(
            eq(products.tenantId, tenantId),
            eq(products.active, true),
            lte(products.stock, products.stockMinimo)
          )
        : and(eq(products.tenantId, tenantId), eq(products.active, true));

      const rows = await tx
        .select()
        .from(products)
        .where(whereClause)
        .orderBy(asc(products.stock), asc(products.code));

      return rows.map((p) => {
        let estadoInventario: InventoryHealthState = "OPTIMO";
        if (p.stock <= 0) {
          estadoInventario = "AGOTADO";
        } else if (p.stock <= p.stockMinimo) {
          estadoInventario = "QUIEBRE_INMINENTE";
        } else if (p.stock > p.stockMaximo) {
          estadoInventario = "SOBRESTOCK";
        }
        const cantidadSugeridaPedir =
          p.stock <= p.stockMinimo ? Math.max(0, p.stockMaximo - p.stock) : 0;

        return {
          id: p.id,
          code: p.code,
          name: p.name,
          stock: p.stock,
          stockMinimo: p.stockMinimo,
          stockMaximo: p.stockMaximo,
          ubicacion: p.ubicacion,
          estadoInventario,
          cantidadSugeridaPedir,
        };
      });
    });
  }

  async listRecentMovements(
    scope: TenantScope,
    limit = 150
  ) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      return tx
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.tenantId, tenantId))
        .orderBy(desc(stockMovements.id))
        .limit(limit);
    });
  }

  async listAdminNotifications(
    scope: TenantScope,
    unreadOnly = false,
    limit = 50
  ) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const whereClause = unreadOnly
        ? and(
            eq(adminNotifications.tenantId, tenantId),
            eq(adminNotifications.isRead, false)
          )
        : eq(adminNotifications.tenantId, tenantId);
      return tx
        .select()
        .from(adminNotifications)
        .where(whereClause)
        .orderBy(desc(adminNotifications.id))
        .limit(limit);
    });
  }

  async markNotificationsRead(
    scope: TenantScope,
    notificationId?: number
  ): Promise<void> {
    await runInTenantTx(scope, async (tx, tenantId) => {
      const condition =
        notificationId !== undefined
          ? and(
              eq(adminNotifications.tenantId, tenantId),
              eq(adminNotifications.id, notificationId)
            )
          : and(
              eq(adminNotifications.tenantId, tenantId),
              eq(adminNotifications.isRead, false)
            );
      await tx.update(adminNotifications).set({ isRead: true }).where(condition);
    });
  }
}

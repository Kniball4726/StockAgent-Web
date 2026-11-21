import { and, eq, sql } from "drizzle-orm";
import {
  coincideCodigoOBarras,
  normalizarCodigo,
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
} from "../../db/schema/index.js";
import { NotFoundError, runInTenantTx, type TenantScope } from "../base.js";

export interface BatchDiscountEntry {
  codigo: string;
  cantidad: number;
}

export class StockOperationsRepository {
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

      if (
        !["sistema", "administrador", "admin"].includes(
          input.usuario.toLowerCase()
        )
      ) {
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
        throw new Error(
          "No se pudo registrar la cabecera de inventario físico."
        );
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
}

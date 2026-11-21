import { and, eq, inArray, isNull } from "drizzle-orm";
import { normalizarCodigo } from "@stockagent/shared";
import {
  factoryPlanItems,
  factoryPlans,
  fullPlanItems,
  fullPlans,
  orders,
  processedTransactions,
  shiftClosures,
} from "../../db/schema/index.js";
import { ConflictError, runInTenantTx, type TenantScope } from "../base.js";

export class OrderOperationsRepository {
  async registerIdempotentTx(
    scope: TenantScope,
    txId: string,
    accion: string,
    detalle = ""
  ): Promise<boolean> {
    if (!txId.trim()) {
      return true;
    }
    return runInTenantTx(scope, async (tx, tenantId) => {
      const inserted = await tx
        .insert(processedTransactions)
        .values({ tenantId, txId: txId.trim(), accion, detalle })
        .onConflictDoNothing()
        .returning({ txId: processedTransactions.txId });
      return inserted.length > 0;
    });
  }

  async registerShiftClosure(
    scope: TenantScope,
    input: {
      usuario: string;
      orderIds: number[];
      articulosTotales: number;
      resumenPedidos: string;
      archivoPdfKey?: string | undefined;
      archivoExcelKey?: string | undefined;
      archivoHojaRutaKey?: string | undefined;
    }
  ) {
    if (input.orderIds.length === 0) {
      throw new ConflictError("No hay pedidos para consolidar en el cierre.");
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const [closure] = await tx
        .insert(shiftClosures)
        .values({
          tenantId,
          usuario: input.usuario,
          cantidadPedidos: input.orderIds.length,
          articulosTotales: input.articulosTotales,
          resumenPedidos: input.resumenPedidos,
          archivoPdfKey: input.archivoPdfKey ?? "",
          archivoExcelKey: input.archivoExcelKey ?? "",
          archivoHojaRutaKey: input.archivoHojaRutaKey ?? "",
        })
        .returning();

      if (!closure) {
        throw new Error("No se pudo registrar el cierre de jornada.");
      }

      await tx
        .update(orders)
        .set({ cierreId: closure.id })
        .where(
          and(
            eq(orders.tenantId, tenantId),
            inArray(orders.id, input.orderIds),
            isNull(orders.cierreId)
          )
        );

      return closure;
    });
  }

  async createFullPlan(
    scope: TenantScope,
    input: {
      nombreEnvio: string;
      archivoOrigen: string;
      creadoPor: string;
      items: Array<{ codigo: string; descripcion: string; cantidad: number }>;
    }
  ) {
    const validItems = input.items.filter((i) => i.cantidad > 0);
    if (validItems.length === 0) {
      throw new ConflictError("No se puede crear un plan Full sin artículos.");
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const articulosTotales = validItems.reduce((acc, i) => acc + i.cantidad, 0);
      const [plan] = await tx
        .insert(fullPlans)
        .values({
          tenantId,
          nombreEnvio: input.nombreEnvio.trim() || "Envío Mercado Full",
          archivoOrigen: input.archivoOrigen,
          creadoPor: input.creadoPor,
          articulosTotales,
        })
        .returning();

      if (!plan) {
        throw new Error("No se pudo crear el plan Mercado Full.");
      }

      await tx.insert(fullPlanItems).values(
        validItems.map((it) => ({
          tenantId,
          planId: plan.id,
          codigo: normalizarCodigo(it.codigo),
          descripcion: it.descripcion.trim(),
          cantidadSolicitada: it.cantidad,
        }))
      );

      return plan;
    });
  }

  async createFactoryPlan(
    scope: TenantScope,
    input: {
      nombreRemito: string;
      archivoRemito: string;
      creadoPor: string;
      items: Array<{ codigo: string; descripcion: string; cantidad: number }>;
    }
  ) {
    const validItems = input.items.filter((i) => i.cantidad > 0);
    if (validItems.length === 0) {
      throw new ConflictError(
        "No se puede crear un plan de ingreso de fábrica sin artículos."
      );
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const articulosEsperados = validItems.reduce(
        (acc, i) => acc + i.cantidad,
        0
      );
      const [plan] = await tx
        .insert(factoryPlans)
        .values({
          tenantId,
          nombreRemito: input.nombreRemito.trim() || "Remito Fábrica",
          archivoRemito: input.archivoRemito,
          creadoPor: input.creadoPor,
          articulosEsperados,
        })
        .returning();

      if (!plan) {
        throw new Error("No se pudo crear el plan de ingreso de fábrica.");
      }

      await tx.insert(factoryPlanItems).values(
        validItems.map((it) => ({
          tenantId,
          planId: plan.id,
          codigo: normalizarCodigo(it.codigo),
          descripcion: it.descripcion.trim(),
          cantidadEsperada: it.cantidad,
        }))
      );

      return plan;
    });
  }
}

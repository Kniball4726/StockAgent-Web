import { and, eq, lt, sql } from "drizzle-orm";
import { ESTADOS_DESPACHO, type EstadoDespacho } from "@stockagent/shared";
import { auditLogs, orderLocks, orders } from "../../db/schema/index.js";
import { runInTenantTx, type TenantScope } from "../base.js";
import type { OrderRecord } from "./order-core-repository.js";

export class DispatchRepository {
  async advanceDispatchState(
    scope: TenantScope,
    input: {
      codigoQrORemito: string;
      usuario: string;
      nuevoEstado?: EstadoDespacho | undefined;
    }
  ): Promise<{ ok: boolean; mensaje: string; order: OrderRecord | null }> {
    const raw = input.codigoQrORemito.trim();
    let remito = raw;
    if (raw.toUpperCase().startsWith("REMITO:")) {
      const firstPart = raw.split("|")[0] ?? raw;
      remito = firstPart.slice("REMITO:".length).trim();
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            sql`(lower(${orders.notaPedido}) = lower(${remito}) OR lower(${orders.numeroPedido}) = lower(${remito}) OR lower(${orders.numeroGuia}) = lower(${remito}))`
          )
        )
        .limit(1);

      if (!order) {
        return {
          ok: false,
          mensaje: `No se encontró ningún pedido con el código o remito '${remito}'.`,
          order: null,
        };
      }
      if (order.estado === "anulado") {
        return {
          ok: false,
          mensaje: `El pedido ${order.notaPedido} está anulado y no puede despacharse.`,
          order,
        };
      }

      let targetState: EstadoDespacho;
      if (input.nuevoEstado && ESTADOS_DESPACHO.includes(input.nuevoEstado)) {
        targetState = input.nuevoEstado;
      } else {
        targetState =
          order.estadoDespacho === "armado"
            ? "despachado"
            : order.estadoDespacho === "despachado"
              ? "entregado"
              : "entregado";
      }

      const now = new Date();
      const [updated] = await tx
        .update(orders)
        .set({
          estadoDespacho: targetState,
          despachadoAt:
            targetState === "despachado" && !order.despachadoAt
              ? now
              : order.despachadoAt,
          despachadoPor:
            targetState === "despachado" && !order.despachadoPor
              ? input.usuario
              : order.despachadoPor,
          entregadoAt: targetState === "entregado" ? now : order.entregadoAt,
          entregadoPor:
            targetState === "entregado" ? input.usuario : order.entregadoPor,
        })
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, order.id)))
        .returning();

      await tx.insert(auditLogs).values({
        tenantId,
        usuario: input.usuario,
        accion: "ACTUALIZAR_DESPACHO",
        detalle: `Pedido ${order.notaPedido}: ${order.estadoDespacho} -> ${targetState}.`,
      });

      return {
        ok: true,
        mensaje: `Pedido ${order.notaPedido} actualizado a '${targetState.toUpperCase()}'.`,
        order: updated ?? order,
      };
    });
  }

  async acquireOrderLock(
    scope: TenantScope,
    orderId: number,
    usuario: string,
    expirationMinutes = 5
  ): Promise<{ acquired: boolean; lockedBy: string }> {
    const cutoff = new Date(Date.now() - expirationMinutes * 60_000);
    return runInTenantTx(scope, async (tx, tenantId) => {
      await tx
        .delete(orderLocks)
        .where(
          and(
            eq(orderLocks.tenantId, tenantId),
            lt(orderLocks.bloqueadoAt, cutoff)
          )
        );

      const [existing] = await tx
        .select()
        .from(orderLocks)
        .where(
          and(eq(orderLocks.tenantId, tenantId), eq(orderLocks.orderId, orderId))
        )
        .limit(1);

      if (existing && existing.usuario.toLowerCase() !== usuario.toLowerCase()) {
        return { acquired: false, lockedBy: existing.usuario };
      }

      await tx
        .insert(orderLocks)
        .values({ orderId, tenantId, usuario, bloqueadoAt: new Date() })
        .onConflictDoUpdate({
          target: orderLocks.orderId,
          set: { usuario, bloqueadoAt: new Date() },
        });

      return { acquired: true, lockedBy: usuario };
    });
  }

  async releaseOrderLock(
    scope: TenantScope,
    orderId: number,
    usuario?: string
  ): Promise<void> {
    await runInTenantTx(scope, async (tx, tenantId) => {
      const condition = usuario
        ? and(
            eq(orderLocks.tenantId, tenantId),
            eq(orderLocks.orderId, orderId),
            sql`lower(${orderLocks.usuario}) = lower(${usuario})`
          )
        : and(eq(orderLocks.tenantId, tenantId), eq(orderLocks.orderId, orderId));
      await tx.delete(orderLocks).where(condition);
    });
  }
}

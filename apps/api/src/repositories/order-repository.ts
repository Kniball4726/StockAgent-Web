import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  clasificarCanalPedido,
  ESTADOS_DESPACHO,
  normalizarCodigo,
  type CanalPedido,
  type EstadoDespacho,
  type LogisticaOpcion,
  type OrderFileType,
  type OrderItemInput,
} from "@stockagent/shared";
import {
  auditLogs,
  customers,
  factoryPlanItems,
  factoryPlans,
  fullPlanItems,
  fullPlans,
  orderItems,
  orderLocks,
  orders,
  processedTransactions,
  products,
  shiftClosures,
} from "../db/schema/index.js";
import { ConflictError, NotFoundError, runInTenantTx, type TenantScope } from "./base.js";

export type OrderRecord = typeof orders.$inferSelect;
export type CustomerRecord = typeof customers.$inferSelect;

export class OrderRepository {
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
          .where(and(eq(customers.tenantId, tenantId), eq(customers.id, existing.id)))
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
          .where(and(eq(customers.tenantId, tenantId), eq(customers.id, created.id)))
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

  async registerOrder(
    scope: TenantScope,
    input: {
      notaPedido: string;
      numeroPedido?: string | undefined;
      cliente: string;
      bultos: number;
      logistica: LogisticaOpcion;
      armador: string;
      tipoArchivo: OrderFileType;
      nombreArchivo?: string | undefined;
      agregado?: boolean | undefined;
      articulosDescontados?: number | undefined;
      resumenItems?: string | undefined;
      fechaRetiro?: string | undefined;
      archivoDescuentoKey?: string | undefined;
      archivoHash?: string | undefined;
      numeroGuia?: string | undefined;
      itemsSinCoincidencia?: Array<[string, string]> | undefined;
      canal?: CanalPedido | undefined;
      items?: OrderItemInput[] | undefined;
      skipDuplicateHashCheck?: boolean | undefined;
    }
  ): Promise<OrderRecord> {
    const notaPedido = input.notaPedido.trim();
    const clienteNombre = input.cliente.trim();
    if (!notaPedido || !clienteNombre) {
      throw new ConflictError("El número de remito/nota y el cliente son obligatorios.");
    }

    const canal = clasificarCanalPedido({
      tipoArchivo: input.tipoArchivo,
      cliente: clienteNombre,
      nombreArchivo: input.nombreArchivo,
      notaPedido,
      logistica: input.logistica,
      canalExplicito: input.canal,
    });

    return runInTenantTx(scope, async (tx, tenantId) => {
      const [dupNota] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            sql`lower(${orders.notaPedido}) = lower(${notaPedido})`
          )
        )
        .limit(1);
      if (dupNota) {
        throw new ConflictError(`El remito/pedido '${notaPedido}' ya fue registrado.`);
      }

      const hash = (input.archivoHash ?? "").trim();
      if (hash && !input.skipDuplicateHashCheck) {
        const [dupHash] = await tx
          .select({ id: orders.id, notaPedido: orders.notaPedido })
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, tenantId),
              eq(orders.archivoHash, hash),
              eq(orders.estado, "descontado")
            )
          )
          .limit(1);
        if (dupHash) {
          throw new ConflictError(
            `El comprobante ya fue procesado anteriormente (${dupHash.notaPedido}).`
          );
        }
      }

      // Asociar o crear cliente en el tenant
      let customerId: number | null = null;
      const [existingCust] = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.tenantId, tenantId),
            sql`lower(${customers.nombre}) = lower(${clienteNombre})`
          )
        )
        .limit(1);

      if (existingCust) {
        customerId = existingCust.id;
      } else {
        const [createdCust] = await tx
          .insert(customers)
          .values({ tenantId, nombre: clienteNombre, activo: true })
          .returning();
        if (createdCust) {
          customerId = createdCust.id;
          await tx
            .update(customers)
            .set({ codigo: `CLI-${String(createdCust.id).padStart(6, "0")}` })
            .where(eq(customers.id, createdCust.id));
        }
      }

      const [created] = await tx
        .insert(orders)
        .values({
          tenantId,
          customerId,
          notaPedido,
          numeroPedido: (input.numeroPedido ?? "").trim(),
          cliente: clienteNombre,
          bultos: Math.max(1, Math.trunc(input.bultos)),
          logistica: input.logistica,
          armador: input.armador.trim() || "Operario",
          tipoArchivo: input.tipoArchivo,
          nombreArchivo: (input.nombreArchivo ?? "").trim(),
          agregado: input.agregado ?? false,
          articulosDescontados: input.articulosDescontados ?? 0,
          resumenItems: (input.resumenItems ?? "").trim(),
          estado: "descontado",
          fechaRetiro: (input.fechaRetiro ?? "").trim(),
          archivoDescuentoKey: (input.archivoDescuentoKey ?? "").trim(),
          archivoHash: hash,
          numeroGuia: (input.numeroGuia ?? "").trim(),
          itemsSinCoincidencia: input.itemsSinCoincidencia ?? [],
          estadoDespacho: "armado",
          canal,
        })
        .returning();

      if (!created) {
        throw new Error("No se pudo registrar el pedido.");
      }

      if (input.items && input.items.length > 0) {
        const catalogRows = await tx
          .select({ id: products.id, code: products.code })
          .from(products)
          .where(eq(products.tenantId, tenantId));
        const productByCode = new Map(
          catalogRows.map((p) => [p.code.toLowerCase(), p.id])
        );

        await tx.insert(orderItems).values(
          input.items.map((item) => {
            const normCode = normalizarCodigo(item.codigo);
            return {
              tenantId,
              orderId: created.id,
              productId: productByCode.get(normCode.toLowerCase()) ?? null,
              codigo: normCode,
              descripcion: item.descripcion.trim(),
              cantidad: item.cantidad,
            };
          })
        );
      }

      await tx.insert(auditLogs).values({
        tenantId,
        usuario: created.armador,
        accion: "REGISTRAR_PEDIDO",
        detalle: `Pedido ${created.notaPedido} (${created.cliente}) · ${created.bultos} bulto(s) · canal ${created.canal}.`,
      });

      return created;
    });
  }

  async findExistingOrdersByNotas(
    scope: TenantScope,
    notas: readonly string[]
  ): Promise<Set<string>> {
    const cleanLower = Array.from(
      new Set(notas.map((n) => n.trim().toLowerCase()).filter(Boolean))
    );
    if (cleanLower.length === 0) {
      return new Set();
    }
    return runInTenantTx(scope, async (tx, tenantId) => {
      const rows = await tx
        .select({ notaPedido: orders.notaPedido })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            sql`lower(${orders.notaPedido}) IN (${sql.join(
              cleanLower.map((n) => sql`${n}`),
              sql`, `
            )})`
          )
        );
      return new Set(rows.map((r) => r.notaPedido));
    });
  }

  async findConfirmedOrdersByHashes(
    scope: TenantScope,
    hashes: readonly string[]
  ): Promise<Map<string, string>> {
    const cleanHashes = Array.from(
      new Set(hashes.map((h) => h.trim()).filter(Boolean))
    );
    if (cleanHashes.length === 0) {
      return new Map();
    }
    return runInTenantTx(scope, async (tx, tenantId) => {
      const rows = await tx
        .select({
          archivoHash: orders.archivoHash,
          notaPedido: orders.notaPedido,
        })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            eq(orders.estado, "descontado"),
            inArray(orders.archivoHash, cleanHashes)
          )
        );
      return new Map(rows.map((r) => [r.archivoHash, r.notaPedido]));
    });
  }

  async listOrders(
    scope: TenantScope,
    options: { estadoDespacho?: EstadoDespacho | undefined; limit?: number | undefined } = {}
  ): Promise<OrderRecord[]> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const whereClause = options.estadoDespacho
        ? and(
            eq(orders.tenantId, tenantId),
            eq(orders.estadoDespacho, options.estadoDespacho)
          )
        : eq(orders.tenantId, tenantId);

      return tx
        .select()
        .from(orders)
        .where(whereClause)
        .orderBy(desc(orders.id))
        .limit(options.limit ?? 50);
    });
  }

  async getOrderWithItems(scope: TenantScope, notaPedido: string) {
    const clean = notaPedido.trim();
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            sql`lower(${orders.notaPedido}) = lower(${clean})`
          )
        )
        .limit(1);

      if (!order) {
        return null;
      }

      const items = await tx
        .select()
        .from(orderItems)
        .where(
          and(eq(orderItems.tenantId, tenantId), eq(orderItems.orderId, order.id))
        )
        .orderBy(asc(orderItems.id));

      return { order, items };
    });
  }

  async listOrdersWithItems(
    scope: TenantScope,
    options: {
      estadoDespacho?: EstadoDespacho | undefined;
      limit?: number | undefined;
    } = {}
  ) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const whereClause = options.estadoDespacho
        ? and(
            eq(orders.tenantId, tenantId),
            eq(orders.estadoDespacho, options.estadoDespacho)
          )
        : eq(orders.tenantId, tenantId);

      const orderRows = await tx
        .select()
        .from(orders)
        .where(whereClause)
        .orderBy(desc(orders.id))
        .limit(options.limit ?? 50);

      if (orderRows.length === 0) {
        return [];
      }

      const orderIds = orderRows.map((o) => o.id);
      const allItems = await tx
        .select()
        .from(orderItems)
        .where(
          and(
            eq(orderItems.tenantId, tenantId),
            inArray(orderItems.orderId, orderIds)
          )
        )
        .orderBy(asc(orderItems.id));

      const itemsByOrder = new Map<number, typeof allItems>();
      for (const item of allItems) {
        const list = itemsByOrder.get(item.orderId) ?? [];
        list.push(item);
        itemsByOrder.set(item.orderId, list);
      }

      return orderRows.map((order) => ({
        order,
        items: itemsByOrder.get(order.id) ?? [],
      }));
    });
  }

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
          entregadoAt:
            targetState === "entregado" ? now : order.entregadoAt,
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

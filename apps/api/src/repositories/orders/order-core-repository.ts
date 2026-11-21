import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  clasificarCanalPedido,
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
  orderItems,
  orders,
  products,
} from "../../db/schema/index.js";
import { ConflictError, runInTenantTx, type TenantScope } from "../base.js";

export type OrderRecord = typeof orders.$inferSelect;

export interface RegisterOrderInput {
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

export class OrderCoreRepository {
  async registerOrder(
    scope: TenantScope,
    input: RegisterOrderInput
  ): Promise<OrderRecord> {
    const notaPedido = input.notaPedido.trim();
    const clienteNombre = input.cliente.trim();
    if (!notaPedido || !clienteNombre) {
      throw new ConflictError(
        "El número de remito/nota y el cliente son obligatorios."
      );
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
        throw new ConflictError(
          `El remito/pedido '${notaPedido}' ya fue registrado.`
        );
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
    options: {
      estadoDespacho?: EstadoDespacho | undefined;
      limit?: number | undefined;
    } = {}
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
}

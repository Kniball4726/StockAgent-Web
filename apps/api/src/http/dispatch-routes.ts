import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  EscanearDespachoRequestSchema,
  EscanearLoteRequestSchema,
  EstadoDespachoSchema,
  type PedidoDetalleResponse,
} from "@stockagent/shared";
import type { Database } from "../db/client.js";
import { DomainError } from "../repositories/base.js";
import type {
  OrderRecord,
  OrderRepository,
} from "../repositories/order-repository.js";
import {
  createDomainEvent,
  type EventBusAdapter,
} from "../realtime/types.js";
import {
  assertRoles,
  authenticateRequest,
  type AuthResolver,
} from "./auth-context.js";

const ListOrdersQuerySchema = z.object({
  estado_despacho: EstadoDespachoSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const NotaParamSchema = z.object({
  nota_pedido: z.string().trim().min(1),
});

const OrderIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

function formatOrderDetail(
  order: OrderRecord,
  items: ReadonlyArray<{ codigo: string; descripcion: string; cantidad: number }>
): PedidoDetalleResponse {
  return {
    id: order.id,
    nota_pedido: order.notaPedido,
    numero_pedido: order.numeroPedido,
    cliente: order.cliente,
    bultos: order.bultos,
    logistica: order.logistica,
    armador: order.armador,
    estado_despacho: order.estadoDespacho,
    created_at: order.createdAt.toISOString(),
    despachado_at: order.despachadoAt ? order.despachadoAt.toISOString() : "",
    despachado_por: order.despachadoPor,
    entregado_at: order.entregadoAt ? order.entregadoAt.toISOString() : "",
    entregado_por: order.entregadoPor,
    items: items.map((it) => ({
      codigo: it.codigo,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
    })),
  };
}

export function registerDispatchRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    authResolver: AuthResolver;
    orderRepo: OrderRepository;
    eventBus: EventBusAdapter;
  }
): void {
  async function processSingleScan(
    tenantId: string,
    usuarioOperario: string,
    actorUsername: string,
    codigo: string,
    nuevoEstado: z.infer<typeof EstadoDespachoSchema> | undefined
  ) {
    const scope = { db: deps.db, tenantId };
    const result = await deps.orderRepo.advanceDispatchState(scope, {
      codigoQrORemito: codigo,
      usuario: usuarioOperario,
      nuevoEstado,
    });

    let pedidoDetalle: PedidoDetalleResponse | null = null;
    if (result.order) {
      const full = await deps.orderRepo.getOrderWithItems(
        scope,
        result.order.notaPedido
      );
      pedidoDetalle = full
        ? formatOrderDetail(full.order, full.items)
        : formatOrderDetail(result.order, []);
    }

    if (result.ok && result.order) {
      await deps.eventBus.publish(
        createDomainEvent({
          tenantId,
          type: "DISPATCH_UPDATED",
          actor: actorUsername,
          payload: {
            order_id: result.order.id,
            nota_pedido: result.order.notaPedido,
            estado_despacho: result.order.estadoDespacho,
          },
        })
      );
    }

    return {
      ok: result.ok,
      mensaje: result.mensaje,
      pedido: pedidoDetalle,
    };
  }

  app.post("/api/v1/despacho/escanear", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["operador", "administrador"]);

    const body = EscanearDespachoRequestSchema.parse(request.body);
    const operatorName = auth.nombre || auth.username;
    return processSingleScan(
      auth.tenantId,
      operatorName,
      auth.username,
      body.codigo,
      body.nuevo_estado
    );
  });

  app.post("/api/v1/despacho/escanear-lote", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["operador", "administrador"]);

    const body = EscanearLoteRequestSchema.parse(request.body);
    const operatorName = auth.nombre || auth.username;

    const resultados = [];
    let exitosos = 0;
    let fallidos = 0;

    for (const item of body.items) {
      const single = await processSingleScan(
        auth.tenantId,
        operatorName,
        auth.username,
        item.codigo,
        item.nuevo_estado
      );
      if (single.ok) {
        exitosos += 1;
      } else {
        fallidos += 1;
      }
      resultados.push(single);
    }

    return {
      ok: true,
      total_procesados: body.items.length,
      exitosos,
      fallidos,
      resultados,
    };
  });

  app.get("/api/v1/despacho/pedidos", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    const rawQuery = (request.query ?? {}) as Record<string, unknown>;
    const normalizedEstado =
      typeof rawQuery.estado_despacho === "string"
        ? rawQuery.estado_despacho.trim().toLowerCase() || undefined
        : undefined;
    const query = ListOrdersQuerySchema.parse({
      ...rawQuery,
      estado_despacho: normalizedEstado,
    });

    const rows = await deps.orderRepo.listOrdersWithItems(
      { db: deps.db, tenantId: auth.tenantId },
      {
        estadoDespacho: query.estado_despacho,
        limit: query.limit,
      }
    );

    const pedidos = rows.map((entry) =>
      formatOrderDetail(entry.order, entry.items)
    );
    return { total: pedidos.length, pedidos };
  });

  app.get("/api/v1/despacho/pedidos/:nota_pedido", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    const { nota_pedido } = NotaParamSchema.parse(request.params);

    const found = await deps.orderRepo.getOrderWithItems(
      { db: deps.db, tenantId: auth.tenantId },
      nota_pedido
    );
    if (!found) {
      throw new DomainError(
        "ORDER_NOT_FOUND",
        `No se encontró ningún pedido con el remito '${nota_pedido}'.`,
        404
      );
    }
    return formatOrderDetail(found.order, found.items);
  });

  app.post("/api/v1/despacho/pedidos/:id/lock", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["operador", "administrador", "picker"]);
    const { id } = OrderIdParamSchema.parse(request.params);

    const lockResult = await deps.orderRepo.acquireOrderLock(
      { db: deps.db, tenantId: auth.tenantId },
      id,
      auth.username
    );
    return { ok: lockResult.acquired, ...lockResult };
  });

  app.delete("/api/v1/despacho/pedidos/:id/lock", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["operador", "administrador", "picker"]);
    const { id } = OrderIdParamSchema.parse(request.params);

    await deps.orderRepo.releaseOrderLock(
      { db: deps.db, tenantId: auth.tenantId },
      id,
      auth.role === "administrador" || auth.role === "master"
        ? undefined
        : auth.username
    );
    return { ok: true };
  });
}

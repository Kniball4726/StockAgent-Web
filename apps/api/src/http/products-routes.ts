import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ActualizarUbicacionRequestSchema,
  AdjustStockRequestSchema,
  AsociarBarcodeRequestSchema,
  UpsertProductRequestSchema,
  type ProductoItemResponse,
} from "@stockagent/shared";
import type { Database } from "../db/client.js";
import { DomainError } from "../repositories/base.js";
import type {
  ProductRecord,
  ProductRepository,
} from "../repositories/product-repository.js";
import {
  createDomainEvent,
  type EventBusAdapter,
} from "../realtime/types.js";
import {
  assertRoles,
  authenticateRequest,
  type AuthResolver,
} from "./auth-context.js";

const SearchProductsQuerySchema = z.object({
  q: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const CodeParamSchema = z.object({
  codigo_o_barcode: z.string().trim().min(1),
});

const ProductCodeParamSchema = z.object({
  codigo: z.string().trim().min(1),
});

const ReplenishmentQuerySchema = z.object({
  solo_criticos: z
    .enum(["true", "false", "1", "0"])
    .optional(),
});

const MovementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(150),
});

function mapProductToFlutterItem(row: ProductRecord): ProductoItemResponse {
  return {
    code: row.code.trim(),
    name: row.name.trim(),
    stock: row.stock,
    stock_fisico: row.stockFisico ?? 0,
    stock_minimo: row.stockMinimo,
    stock_maximo: row.stockMaximo,
    cod_barras: row.codBarras.trim(),
    ubicacion: row.ubicacion.trim(),
    active: row.active,
  };
}

export function registerProductsRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    authResolver: AuthResolver;
    productRepo: ProductRepository;
    eventBus: EventBusAdapter;
  }
): void {
  app.get("/api/v1/productos/buscar", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    const query = SearchProductsQuerySchema.parse(request.query);
    const scope = { db: deps.db, tenantId: auth.tenantId };

    const rows = query.q.trim()
      ? await deps.productRepo.searchProducts(scope, query.q, query.limit)
      : (await deps.productRepo.listProducts(scope, true)).slice(0, query.limit);

    const productos = rows.map(mapProductToFlutterItem);
    return { total: productos.length, productos };
  });

  app.get("/api/v1/productos/reposicion/analisis", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    const query = ReplenishmentQuerySchema.parse(request.query);
    const onlyCritical =
      query.solo_criticos !== "false" && query.solo_criticos !== "0";

    const items = await deps.productRepo.getReplenishmentAnalysis(
      { db: deps.db, tenantId: auth.tenantId },
      onlyCritical
    );
    return { ok: true, total: items.length, items };
  });

  app.get("/api/v1/productos/movimientos/historial", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    const query = MovementsQuerySchema.parse(request.query);
    const movements = await deps.productRepo.listRecentMovements(
      { db: deps.db, tenantId: auth.tenantId },
      query.limit
    );
    return { ok: true, total: movements.length, movimientos: movements };
  });

  app.post("/api/v1/productos", async (request, reply) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador"]);
    const body = UpsertProductRequestSchema.parse(request.body);

    const saved = await deps.productRepo.createOrUpdateProduct(
      { db: deps.db, tenantId: auth.tenantId },
      {
        code: body.code,
        name: body.name,
        stock: body.stock,
        stockMinimo: body.stock_minimo,
        stockMaximo: body.stock_maximo,
        codBarras: body.cod_barras,
        ubicacion: body.ubicacion,
        active: body.active,
        usuario: auth.username,
      }
    );

    await deps.eventBus.publish(
      createDomainEvent({
        tenantId: auth.tenantId,
        type: "PRODUCT_UPDATED",
        actor: auth.username,
        payload: { code: saved.code, stock: saved.stock },
      })
    );

    return reply.code(201).send({
      ok: true,
      producto: mapProductToFlutterItem(saved),
    });
  });

  app.get("/api/v1/productos/:codigo_o_barcode", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    const { codigo_o_barcode } = CodeParamSchema.parse(request.params);

    const prod = await deps.productRepo.findProductByCodeOrBarcode(
      { db: deps.db, tenantId: auth.tenantId },
      codigo_o_barcode
    );
    if (!prod) {
      throw new DomainError(
        "PRODUCT_NOT_FOUND",
        `Producto '${codigo_o_barcode}' no encontrado en el catálogo.`,
        404
      );
    }
    return mapProductToFlutterItem(prod);
  });

  app.put("/api/v1/productos/:codigo/ubicacion", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["operador", "administrador"]);
    const { codigo } = ProductCodeParamSchema.parse(request.params);
    const body = ActualizarUbicacionRequestSchema.parse(request.body);

    const updated = await deps.productRepo.updateLocation(
      { db: deps.db, tenantId: auth.tenantId },
      codigo,
      body.ubicacion
    );

    await deps.eventBus.publish(
      createDomainEvent({
        tenantId: auth.tenantId,
        type: "PRODUCT_UPDATED",
        actor: auth.username,
        payload: { code: updated.code, ubicacion: updated.ubicacion },
      })
    );

    return {
      ok: true,
      codigo: updated.code.toUpperCase(),
      ubicacion: updated.ubicacion,
      mensaje: `Ubicación actualizada a '${updated.ubicacion}'.`,
    };
  });

  app.put("/api/v1/productos/:codigo/codigo-barras", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["operador", "administrador"]);
    const { codigo } = ProductCodeParamSchema.parse(request.params);
    const body = AsociarBarcodeRequestSchema.parse(request.body);

    const updated = await deps.productRepo.setBarcode(
      { db: deps.db, tenantId: auth.tenantId },
      codigo,
      body.cod_barras
    );

    await deps.eventBus.publish(
      createDomainEvent({
        tenantId: auth.tenantId,
        type: "PRODUCT_UPDATED",
        actor: auth.username,
        payload: { code: updated.code, cod_barras: updated.codBarras },
      })
    );

    return {
      ok: true,
      codigo: updated.code,
      cod_barras: updated.codBarras,
      mensaje: `Código de barras '${updated.codBarras}' vinculado exitosamente a ${updated.code}.`,
    };
  });

  app.post("/api/v1/productos/:codigo/ajustar", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["operador", "administrador"]);
    const { codigo } = ProductCodeParamSchema.parse(request.params);
    const body = AdjustStockRequestSchema.parse(request.body);

    const result = await deps.productRepo.adjustStockAtomic(
      { db: deps.db, tenantId: auth.tenantId },
      {
        codigo,
        delta: body.delta,
        movementType: body.movement_type,
        usuario: auth.username,
        detalle: body.detalle,
      }
    );

    await deps.eventBus.publish(
      createDomainEvent({
        tenantId: auth.tenantId,
        type: "STOCK_UPDATED",
        actor: auth.username,
        payload: {
          code: result.product.code,
          delta: body.delta,
          stock_anterior: result.stockAnterior,
          stock_nuevo: result.stockNuevo,
        },
      })
    );

    return {
      ok: true,
      producto: mapProductToFlutterItem(result.product),
      stock_anterior: result.stockAnterior,
      stock_nuevo: result.stockNuevo,
    };
  });

  app.get("/api/v1/productos/:codigo/stock", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    const { codigo } = ProductCodeParamSchema.parse(request.params);

    const prod = await deps.productRepo.findProductByCodeOrBarcode(
      { db: deps.db, tenantId: auth.tenantId },
      codigo
    );
    if (!prod) {
      throw new DomainError(
        "PRODUCT_NOT_FOUND",
        `Producto '${codigo}' no encontrado.`,
        404
      );
    }

    return {
      ok: true,
      code: prod.code.trim(),
      codigo: prod.code.trim(),
      name: prod.name.trim(),
      nombre: prod.name.trim(),
      stock: prod.stock,
      stock_minimo: prod.stockMinimo,
      active: prod.active,
    };
  });
}

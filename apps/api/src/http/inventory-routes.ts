import type { FastifyInstance } from "fastify";
import {
  coincideCodigoOBarras,
  ConteoInventarioRequestSchema,
  normalizarCodigo,
  type InventarioItemComparativa,
} from "@stockagent/shared";
import type { Database } from "../db/client.js";
import type { AuditChatRepository } from "../repositories/audit-chat-repository.js";
import type {
  ProductRecord,
  ProductRepository,
} from "../repositories/product-repository.js";
import {
  createDomainEvent,
  type EventBusAdapter,
  type QueueAdapter,
} from "../realtime/types.js";
import {
  assertRoles,
  authenticateRequest,
  type AuthResolver,
} from "./auth-context.js";

function buildComparisonFromCatalog(
  conteo: Record<string, number>,
  catalog: readonly ProductRecord[]
): {
  items: InventarioItemComparativa[];
  coinciden: number;
  faltantes: number;
  sobrantes: number;
} {
  const byCode = new Map(catalog.map((p) => [p.code.toLowerCase(), p]));
  const items: InventarioItemComparativa[] = [];
  let coinciden = 0;
  let faltantes = 0;
  let sobrantes = 0;

  for (const [rawCode, qty] of Object.entries(conteo)) {
    const clean = normalizarCodigo(rawCode);
    const prod =
      byCode.get(clean.toLowerCase()) ??
      catalog.find((p) => coincideCodigoOBarras(p, rawCode));
    const stockFisico = Math.max(0, Math.trunc(qty));

    if (!prod) {
      items.push({
        codigo: clean || rawCode,
        nombre: "Producto no catalogado",
        stock_sistema: 0,
        stock_fisico: stockFisico,
        diferencia: stockFisico,
        estado: "NO_CATALOGADO",
      });
      continue;
    }

    const diferencia = stockFisico - prod.stock;
    let estado: InventarioItemComparativa["estado"] = "COINCIDE";
    if (diferencia === 0) {
      coinciden += 1;
    } else if (diferencia < 0) {
      estado = "FALTANTE";
      faltantes += 1;
    } else {
      estado = "SOBRANTE";
      sobrantes += 1;
    }

    items.push({
      codigo: prod.code,
      nombre: prod.name,
      stock_sistema: prod.stock,
      stock_fisico: stockFisico,
      diferencia,
      estado,
    });
  }

  return { items, coinciden, faltantes, sobrantes };
}

export function registerInventoryRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    authResolver: AuthResolver;
    productRepo: ProductRepository;
    auditRepo: AuditChatRepository;
    eventBus: EventBusAdapter;
    queue: QueueAdapter;
  }
): void {
  app.post("/api/v1/inventario/comparar-preliminar", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["operador", "administrador"]);

    const body = ConteoInventarioRequestSchema.parse(request.body);
    const catalog = await deps.productRepo.listProducts(
      { db: deps.db, tenantId: auth.tenantId },
      true
    );

    const summary = buildComparisonFromCatalog(body.conteo, catalog);
    return {
      total_items: summary.items.length,
      coinciden: summary.coinciden,
      faltantes: summary.faltantes,
      sobrantes: summary.sobrantes,
      items: summary.items,
    };
  });

  app.post("/api/v1/inventario/finalizar", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["operador", "administrador"]);

    const body = ConteoInventarioRequestSchema.parse(request.body);
    const operator = auth.nombre || auth.username;
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 15);
    const nombreArchivo =
      body.nombre_archivo?.trim() || `Inventario_Movil_${stamp}`;

    const scope = { db: deps.db, tenantId: auth.tenantId };
    const recorded = await deps.productRepo.recordPhysicalInventory(scope, {
      usuario: operator,
      nombreArchivo,
      conteo: body.conteo,
    });

    let coinciden = 0;
    let faltantes = 0;
    let sobrantes = 0;
    const comparativa: InventarioItemComparativa[] = recorded.items.map((it) => {
      let estado: InventarioItemComparativa["estado"] = "NO_CATALOGADO";
      if (it.estado === "COINCIDE") {
        estado = "COINCIDE";
        coinciden += 1;
      } else if (it.estado === "FALTANTE") {
        estado = "FALTANTE";
        faltantes += 1;
      } else if (it.estado === "SOBRANTE") {
        estado = "SOBRANTE";
        sobrantes += 1;
      }
      return {
        codigo: it.codigo,
        nombre: it.nombre,
        stock_sistema: it.stockDigital,
        stock_fisico: it.stockFisico,
        diferencia: it.diferencia,
        estado,
      };
    });

    await deps.auditRepo.logAudit(
      scope,
      auth.username,
      "INVENTARIO_FISICO_MOVIL",
      `Relevamiento #${recorded.inventoryId} (${nombreArchivo}): ${comparativa.length} ítem(s), ${recorded.totalDiferencias} diferencia(s).`
    );

    await deps.queue.enqueue("inventory_reports", {
      name: "inventory_finalized",
      tenantId: auth.tenantId,
      data: {
        inventoryId: recorded.inventoryId,
        nombreArchivo,
        totalItems: comparativa.length,
        totalDiferencias: recorded.totalDiferencias,
      },
    });

    await deps.eventBus.publish(
      createDomainEvent({
        tenantId: auth.tenantId,
        type: "INVENTORY_FINALIZED",
        actor: auth.username,
        payload: {
          inventory_id: recorded.inventoryId,
          total_items: comparativa.length,
          coinciden,
          faltantes,
          sobrantes,
        },
      })
    );

    return {
      ok: true,
      mensaje: "Relevamiento de inventario registrado y procesado exitosamente.",
      total_items: comparativa.length,
      coinciden,
      faltantes,
      sobrantes,
      archivo_generado: null,
      comparativa,
    };
  });
}

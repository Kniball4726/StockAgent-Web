import {
  normalizarCodigo,
  resolverProductoEnCatalogo,
  type CatalogProductSnapshot,
  type ConfirmIngestionRequest,
  type OrderItemInput,
  type SimulationResult,
} from "@stockagent/shared";
import type { AuditChatRepository } from "../../repositories/audit-chat-repository.js";
import type { TenantScope } from "../../repositories/base.js";
import type { OrderRepository } from "../../repositories/order-repository.js";
import type { ProductRepository } from "../../repositories/product-repository.js";

export interface IngestionExecutionDeps {
  productRepo: ProductRepository;
  orderRepo: OrderRepository;
  auditRepo: AuditChatRepository;
}

export interface IngestionExecutionContext {
  txScope: TenantScope;
  parsed: ConfirmIngestionRequest;
  simulation: SimulationResult;
  catalog: CatalogProductSnapshot[];
  operator: string;
  sourceLabel: string;
}

export interface OperationExecutionResult {
  dispatchId: number | null;
  orderIds: number[];
  inventoryIds: number[];
  planIds: number[];
  totalUnidadesAplicadas: number;
}

function emptyResult(): OperationExecutionResult {
  return {
    dispatchId: null,
    orderIds: [],
    inventoryIds: [],
    planIds: [],
    totalUnidadesAplicadas: 0,
  };
}

function resolvePlanItems(
  items: ConfirmIngestionRequest["documents"][number]["items"],
  catalog: readonly CatalogProductSnapshot[]
) {
  return items
    .filter((it) => Math.trunc(it.cantidad) > 0)
    .map((it) => {
      const resolved = resolverProductoEnCatalogo(catalog, it.codigo);
      return {
        codigo: resolved ? resolved.code : normalizarCodigo(it.codigo),
        descripcion: it.descripcion.trim() || resolved?.name || "",
        cantidad: Math.trunc(it.cantidad),
      };
    });
}

async function executeDescuentoPedidos(
  deps: IngestionExecutionDeps,
  ctx: IngestionExecutionContext
): Promise<OperationExecutionResult> {
  const result = emptyResult();
  const batchEntries = ctx.simulation.matchedItems
    .filter((m) => -m.delta > 0)
    .map((m) => ({
      codigo: m.codigoCatalogo,
      cantidad: -m.delta,
    }));

  if (batchEntries.length > 0) {
    const batchResult = await deps.productRepo.applyBatchDiscounts(ctx.txScope, {
      tipoOrigen: ctx.parsed.documents[0]?.tipoArchivo ?? "carga",
      nombreArchivo: ctx.sourceLabel,
      usuario: ctx.operator,
      items: batchEntries,
    });
    result.dispatchId =
      batchResult.dispatchId > 0 ? batchResult.dispatchId : null;
    result.totalUnidadesAplicadas = batchResult.totalUnidades;
  }

  for (const doc of ctx.parsed.documents) {
    const docMatchedItems: OrderItemInput[] = [];
    const docUnmatched: Array<[string, string]> = [];
    let docQtyTotal = 0;

    for (const rawItem of doc.items) {
      const qty = Math.trunc(rawItem.cantidad);
      if (qty <= 0) {
        continue;
      }
      const prod = resolverProductoEnCatalogo(ctx.catalog, rawItem.codigo);
      if (!prod) {
        docUnmatched.push([
          normalizarCodigo(rawItem.codigo) || rawItem.codigo,
          "Código no encontrado en catálogo",
        ]);
        continue;
      }
      docQtyTotal += qty;
      docMatchedItems.push({
        codigo: prod.code,
        descripcion: rawItem.descripcion.trim() || prod.name,
        cantidad: qty,
      });
    }

    let storageKeyForDoc = "";
    if (doc.sourceFileId) {
      const fileRow = await deps.auditRepo.getStoredFileById(
        ctx.txScope,
        doc.sourceFileId
      );
      if (fileRow) {
        storageKeyForDoc = fileRow.storageKey;
      }
    }

    const resumenItems = docMatchedItems
      .slice(0, 8)
      .map((it) => `${it.codigo} x${it.cantidad}`)
      .join(", ");

    const createdOrder = await deps.orderRepo.registerOrder(ctx.txScope, {
      notaPedido: doc.notaPedido,
      numeroPedido: doc.numeroPedido,
      cliente: doc.cliente,
      bultos: doc.bultos,
      logistica: doc.logistica,
      armador: doc.armador.trim() || ctx.operator,
      tipoArchivo: doc.tipoArchivo,
      nombreArchivo: doc.nombreArchivo,
      agregado: docUnmatched.length > 0,
      articulosDescontados: docQtyTotal,
      resumenItems,
      fechaRetiro: doc.fechaRetiro,
      archivoDescuentoKey: storageKeyForDoc,
      archivoHash: doc.archivoHash,
      numeroGuia: doc.numeroGuia,
      itemsSinCoincidencia: docUnmatched,
      canal: doc.canal,
      items: docMatchedItems,
      skipDuplicateHashCheck: true,
    });
    result.orderIds.push(createdOrder.id);
  }

  return result;
}

async function executeIngresoFabrica(
  deps: IngestionExecutionDeps,
  ctx: IngestionExecutionContext
): Promise<OperationExecutionResult> {
  const result = emptyResult();
  for (const matched of ctx.simulation.matchedItems) {
    const qtyIngresada = matched.delta;
    const actualDelta = ctx.parsed.sobrescribirStock
      ? Math.max(0, qtyIngresada) - matched.stockAnterior
      : qtyIngresada;

    if (actualDelta !== 0) {
      await deps.productRepo.adjustStockAtomic(ctx.txScope, {
        codigo: matched.codigoCatalogo,
        delta: actualDelta,
        movementType: ctx.parsed.sobrescribirStock
          ? "ajuste_manual"
          : "ingreso_fabrica",
        usuario: ctx.operator,
        detalle: `Carga fábrica: ${ctx.sourceLabel}`.slice(0, 120),
      });
      result.totalUnidadesAplicadas += Math.abs(actualDelta);
    }
  }
  return result;
}

async function executeStockFisico(
  deps: IngestionExecutionDeps,
  ctx: IngestionExecutionContext
): Promise<OperationExecutionResult> {
  const result = emptyResult();
  const conteo: Record<string, number> = {};
  for (const item of ctx.simulation.consolidatedItems) {
    conteo[item.codigo] = item.cantidadTotal;
  }
  const physResult = await deps.productRepo.recordPhysicalInventory(
    ctx.txScope,
    {
      usuario: ctx.operator,
      nombreArchivo: ctx.sourceLabel,
      conteo,
    }
  );
  result.inventoryIds.push(physResult.inventoryId);
  result.totalUnidadesAplicadas = ctx.simulation.consolidatedItems.reduce(
    (acc, it) => acc + it.cantidadTotal,
    0
  );
  return result;
}

async function executePlanFull(
  deps: IngestionExecutionDeps,
  ctx: IngestionExecutionContext
): Promise<OperationExecutionResult> {
  const result = emptyResult();
  for (const doc of ctx.parsed.documents) {
    const plan = await deps.orderRepo.createFullPlan(ctx.txScope, {
      nombreEnvio: doc.notaPedido,
      archivoOrigen: doc.nombreArchivo || doc.notaPedido,
      creadoPor: ctx.operator,
      items: resolvePlanItems(doc.items, ctx.catalog),
    });
    result.planIds.push(plan.id);
    result.totalUnidadesAplicadas += plan.articulosTotales;
  }
  return result;
}

async function executePlanFabrica(
  deps: IngestionExecutionDeps,
  ctx: IngestionExecutionContext
): Promise<OperationExecutionResult> {
  const result = emptyResult();
  for (const doc of ctx.parsed.documents) {
    const plan = await deps.orderRepo.createFactoryPlan(ctx.txScope, {
      nombreRemito: doc.notaPedido,
      archivoRemito: doc.nombreArchivo || doc.notaPedido,
      creadoPor: ctx.operator,
      items: resolvePlanItems(doc.items, ctx.catalog),
    });
    result.planIds.push(plan.id);
    result.totalUnidadesAplicadas += plan.articulosEsperados;
  }
  return result;
}

export async function executeIngestionOperation(
  deps: IngestionExecutionDeps,
  ctx: IngestionExecutionContext
): Promise<OperationExecutionResult> {
  switch (ctx.parsed.operation) {
    case "descuento_pedidos":
      return executeDescuentoPedidos(deps, ctx);
    case "ingreso_fabrica":
      return executeIngresoFabrica(deps, ctx);
    case "stock_fisico":
      return executeStockFisico(deps, ctx);
    case "plan_full":
      return executePlanFull(deps, ctx);
    case "plan_fabrica":
      return executePlanFabrica(deps, ctx);
  }
}

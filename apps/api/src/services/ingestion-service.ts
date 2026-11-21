import {
  consolidarDocumentos,
  ConfirmIngestionRequestSchema,
  normalizarCodigo,
  resolverProductoEnCatalogo,
  SimulateIngestionRequestSchema,
  simularImpactoStock,
  type CatalogProductSnapshot,
  type ConfirmIngestionRequest,
  type OrderItemInput,
  type SimulateIngestionRequest,
  type SimulationResult,
} from "@stockagent/shared";
import { AuditChatRepository } from "../repositories/audit-chat-repository.js";
import { ConflictError, runInTenantTx, type TenantScope } from "../repositories/base.js";
import { OrderRepository } from "../repositories/order-repository.js";
import { ProductRepository } from "../repositories/product-repository.js";

export interface ConfirmIngestionResult {
  operation: ConfirmIngestionRequest["operation"];
  txId: string | null;
  simulation: SimulationResult;
  dispatchId: number | null;
  orderIds: number[];
  inventoryIds: number[];
  planIds: number[];
  totalUnidadesAplicadas: number;
}

function toCatalogSnapshots(
  rows: Awaited<ReturnType<ProductRepository["listProducts"]>>
): CatalogProductSnapshot[] {
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    stock: p.stock,
    stockMinimo: p.stockMinimo,
    stockMaximo: p.stockMaximo,
    codBarras: p.codBarras,
    ubicacion: p.ubicacion,
  }));
}

export class IngestionService {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly orderRepo: OrderRepository,
    private readonly auditRepo: AuditChatRepository
  ) {}

  consolidate(
    documents: SimulateIngestionRequest["documents"],
    allowZero = false
  ) {
    return consolidarDocumentos(documents, { allowZero });
  }

  private async runSimulationInTx(
    txScope: TenantScope,
    parsed: SimulateIngestionRequest
  ): Promise<{
    simulation: SimulationResult;
    catalog: CatalogProductSnapshot[];
  }> {
    const productRows = await this.productRepo.listProducts(txScope, true);
    const catalog = toCatalogSnapshots(productRows);

    const notas = parsed.documents.map((d) => d.notaPedido);
    const hashes = parsed.documents
      .map((d) => d.archivoHash)
      .filter((h) => h.trim().length > 0);

    const [existingNotas, existingHashes] = await Promise.all([
      this.orderRepo.findExistingOrdersByNotas(txScope, notas),
      this.orderRepo.findConfirmedOrdersByHashes(txScope, hashes),
    ]);

    const simulation = simularImpactoStock({
      operation: parsed.operation,
      documents: parsed.documents,
      catalog,
      existingNotas,
      existingHashes,
      failOnUnmatched: parsed.failOnUnmatched,
    });

    return { simulation, catalog };
  }

  async simulate(
    scope: TenantScope,
    request: SimulateIngestionRequest
  ): Promise<SimulationResult> {
    const parsed = SimulateIngestionRequestSchema.parse(request);
    return runInTenantTx(scope, async (tx, tenantId) => {
      const txScope: TenantScope = { db: scope.db, tenantId, tx };
      const { simulation } = await this.runSimulationInTx(txScope, parsed);
      return simulation;
    });
  }

  async confirm(
    scope: TenantScope,
    request: ConfirmIngestionRequest
  ): Promise<ConfirmIngestionResult> {
    const parsed = ConfirmIngestionRequestSchema.parse(request);
    const operator =
      (parsed.usuario ?? "").trim() ||
      parsed.documents[0]?.armador.trim() ||
      "sistema";

    return runInTenantTx(scope, async (tx, tenantId) => {
      const txScope: TenantScope = { db: scope.db, tenantId, tx };

      if (parsed.txId) {
        const accepted = await this.orderRepo.registerIdempotentTx(
          txScope,
          parsed.txId,
          `INGESTION_${parsed.operation.toUpperCase()}`,
          `${parsed.documents.length} documento(s)`
        );
        if (!accepted) {
          throw new ConflictError(
            `La transacción '${parsed.txId}' ya fue confirmada anteriormente.`,
            "IDEMPOTENT_DUPLICATE"
          );
        }
      }

      const { simulation, catalog } = await this.runSimulationInTx(txScope, {
        operation: parsed.operation,
        documents: parsed.documents,
        failOnUnmatched: parsed.failOnUnmatched,
      });

      if (!simulation.canConfirm) {
        throw new ConflictError(
          simulation.blockingErrors[0] ??
            "La operación contiene conflictos bloqueantes.",
          "SIMULATION_BLOCKED"
        );
      }

      let dispatchId: number | null = null;
      const orderIds: number[] = [];
      const inventoryIds: number[] = [];
      const planIds: number[] = [];
      let totalUnidadesAplicadas = 0;

      const sourceLabel =
        parsed.documents
          .map((d) => d.nombreArchivo || d.notaPedido)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ") || "carga-manual";

      if (parsed.operation === "descuento_pedidos") {
        const batchEntries = simulation.matchedItems
          .filter((m) => -m.delta > 0)
          .map((m) => ({
            codigo: m.codigoCatalogo,
            cantidad: -m.delta,
          }));

        if (batchEntries.length > 0) {
          const batchResult = await this.productRepo.applyBatchDiscounts(
            txScope,
            {
              tipoOrigen: parsed.documents[0]?.tipoArchivo ?? "carga",
              nombreArchivo: sourceLabel,
              usuario: operator,
              items: batchEntries,
            }
          );
          dispatchId = batchResult.dispatchId > 0 ? batchResult.dispatchId : null;
          totalUnidadesAplicadas = batchResult.totalUnidades;
        }

        for (const doc of parsed.documents) {
          const docMatchedItems: OrderItemInput[] = [];
          const docUnmatched: Array<[string, string]> = [];
          let docQtyTotal = 0;

          for (const rawItem of doc.items) {
            const qty = Math.trunc(rawItem.cantidad);
            if (qty <= 0) {
              continue;
            }
            const prod = resolverProductoEnCatalogo(catalog, rawItem.codigo);
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
            const fileRow = await this.auditRepo.getStoredFileById(
              txScope,
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

          const createdOrder = await this.orderRepo.registerOrder(txScope, {
            notaPedido: doc.notaPedido,
            numeroPedido: doc.numeroPedido,
            cliente: doc.cliente,
            bultos: doc.bultos,
            logistica: doc.logistica,
            armador: doc.armador.trim() || operator,
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
          orderIds.push(createdOrder.id);
        }
      } else if (parsed.operation === "ingreso_fabrica") {
        for (const matched of simulation.matchedItems) {
          const qtyIngresada = matched.delta;
          const actualDelta = parsed.sobrescribirStock
            ? Math.max(0, qtyIngresada) - matched.stockAnterior
            : qtyIngresada;

          if (actualDelta !== 0) {
            await this.productRepo.adjustStockAtomic(txScope, {
              codigo: matched.codigoCatalogo,
              delta: actualDelta,
              movementType: parsed.sobrescribirStock
                ? "ajuste_manual"
                : "ingreso_fabrica",
              usuario: operator,
              detalle: `Carga fábrica: ${sourceLabel}`.slice(0, 120),
            });
            totalUnidadesAplicadas += Math.abs(actualDelta);
          }
        }
      } else if (parsed.operation === "stock_fisico") {
        const conteo: Record<string, number> = {};
        for (const item of simulation.consolidatedItems) {
          conteo[item.codigo] = item.cantidadTotal;
        }
        const physResult = await this.productRepo.recordPhysicalInventory(
          txScope,
          {
            usuario: operator,
            nombreArchivo: sourceLabel,
            conteo,
          }
        );
        inventoryIds.push(physResult.inventoryId);
        totalUnidadesAplicadas = simulation.consolidatedItems.reduce(
          (acc, it) => acc + it.cantidadTotal,
          0
        );
      } else if (parsed.operation === "plan_full") {
        for (const doc of parsed.documents) {
          const validItems = doc.items
            .filter((it) => Math.trunc(it.cantidad) > 0)
            .map((it) => {
              const resolved = resolverProductoEnCatalogo(catalog, it.codigo);
              return {
                codigo: resolved ? resolved.code : normalizarCodigo(it.codigo),
                descripcion: it.descripcion.trim() || resolved?.name || "",
                cantidad: Math.trunc(it.cantidad),
              };
            });
          const plan = await this.orderRepo.createFullPlan(txScope, {
            nombreEnvio: doc.notaPedido,
            archivoOrigen: doc.nombreArchivo || doc.notaPedido,
            creadoPor: operator,
            items: validItems,
          });
          planIds.push(plan.id);
          totalUnidadesAplicadas += plan.articulosTotales;
        }
      } else if (parsed.operation === "plan_fabrica") {
        for (const doc of parsed.documents) {
          const validItems = doc.items
            .filter((it) => Math.trunc(it.cantidad) > 0)
            .map((it) => {
              const resolved = resolverProductoEnCatalogo(catalog, it.codigo);
              return {
                codigo: resolved ? resolved.code : normalizarCodigo(it.codigo),
                descripcion: it.descripcion.trim() || resolved?.name || "",
                cantidad: Math.trunc(it.cantidad),
              };
            });
          const plan = await this.orderRepo.createFactoryPlan(txScope, {
            nombreRemito: doc.notaPedido,
            archivoRemito: doc.nombreArchivo || doc.notaPedido,
            creadoPor: operator,
            items: validItems,
          });
          planIds.push(plan.id);
          totalUnidadesAplicadas += plan.articulosEsperados;
        }
      }

      await this.auditRepo.logAudit(
        txScope,
        operator,
        "CONFIRMAR_INGESTION",
        `Operación ${parsed.operation}: ${parsed.documents.length} doc(s), ${totalUnidadesAplicadas} unidad(es), pedidos=[${orderIds.join(",")}].`
      );

      return {
        operation: parsed.operation,
        txId: parsed.txId ?? null,
        simulation,
        dispatchId,
        orderIds,
        inventoryIds,
        planIds,
        totalUnidadesAplicadas,
      };
    });
  }
}

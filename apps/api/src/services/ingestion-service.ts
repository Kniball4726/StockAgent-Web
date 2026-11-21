import {
  consolidarDocumentos,
  ConfirmIngestionRequestSchema,
  SimulateIngestionRequestSchema,
  simularImpactoStock,
  type CatalogProductSnapshot,
  type ConfirmIngestionRequest,
  type SimulateIngestionRequest,
  type SimulationResult,
} from "@stockagent/shared";
import { AuditChatRepository } from "../repositories/audit-chat-repository.js";
import {
  ConflictError,
  runInTenantTx,
  type TenantScope,
} from "../repositories/base.js";
import { OrderRepository } from "../repositories/order-repository.js";
import { ProductRepository } from "../repositories/product-repository.js";
import { executeIngestionOperation } from "./ingestion/operation-handlers.js";

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

      const sourceLabel =
        parsed.documents
          .map((d) => d.nombreArchivo || d.notaPedido)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ") || "carga-manual";

      const execResult = await executeIngestionOperation(
        {
          productRepo: this.productRepo,
          orderRepo: this.orderRepo,
          auditRepo: this.auditRepo,
        },
        {
          txScope,
          parsed,
          simulation,
          catalog,
          operator,
          sourceLabel,
        }
      );

      await this.auditRepo.logAudit(
        txScope,
        operator,
        "CONFIRMAR_INGESTION",
        `Operación ${parsed.operation}: ${parsed.documents.length} doc(s), ${execResult.totalUnidadesAplicadas} unidad(es), pedidos=[${execResult.orderIds.join(",")}].`
      );

      return {
        operation: parsed.operation,
        txId: parsed.txId ?? null,
        simulation,
        ...execResult,
      };
    });
  }
}

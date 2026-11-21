import { coincideCodigoOBarras, normalizarCodigo } from "../domain.js";
import { consolidarDocumentos } from "./consolidator.js";
import type {
  ConsolidatedItem,
  IngestionDocumentInput,
  IngestionOperation,
} from "./schemas.js";

export interface CatalogProductSnapshot {
  id: number;
  code: string;
  name: string;
  stock: number;
  stockMinimo: number;
  stockMaximo: number;
  codBarras: string;
  ubicacion: string;
}

export interface SimulationMatchedItem {
  codigoSolicitado: string;
  codigoCatalogo: string;
  productId: number;
  nombre: string;
  stockAnterior: number;
  delta: number;
  stockNuevo: number;
  stockMinimo: number;
  ubicacion: string;
  quiebre: boolean;
  stockCritico: boolean;
  remitosOrigen: string[];
}

export interface SimulationUnmatchedItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  remitosOrigen: string[];
  motivo: string;
}

export interface SimulationDocumentSummary {
  notaPedido: string;
  cliente: string;
  articulosDeclarados: number | null;
  articulosExtraidos: number;
  verificacionOk: boolean;
  itemsMatched: number;
  itemsUnmatched: number;
}

export interface SimulationResult {
  operation: IngestionOperation;
  readOnly: true;
  canConfirm: boolean;
  blockingErrors: string[];
  warnings: string[];
  totalDocumentos: number;
  totalUnidades: number;
  documentSummaries: SimulationDocumentSummary[];
  consolidatedItems: ConsolidatedItem[];
  duplicadosConsolidados: ConsolidatedItem[];
  matchedItems: SimulationMatchedItem[];
  unmatchedItems: SimulationUnmatchedItem[];
  quiebres: SimulationMatchedItem[];
  criticos: SimulationMatchedItem[];
  duplicateNotas: string[];
  duplicateHashes: Array<{ archivoHash: string; existingNotaPedido: string }>;
}

/**
 * Resuelve un código o lectura de pistola contra el catálogo activo del tenant.
 */
export function resolverProductoEnCatalogo(
  catalog: readonly CatalogProductSnapshot[],
  rawCode: string
): CatalogProductSnapshot | null {
  const norm = normalizarCodigo(rawCode);
  if (!norm) {
    return null;
  }
  const lower = norm.toLowerCase();
  const exact = catalog.find((p) => p.code.toLowerCase() === lower);
  if (exact) {
    return exact;
  }
  return catalog.find((p) => coincideCodigoOBarras(p, rawCode)) ?? null;
}

function computeStockImpact(
  operation: IngestionOperation,
  currentStock: number,
  quantity: number
): { delta: number; stockNuevo: number } {
  if (operation === "descuento_pedidos" || operation === "plan_full") {
    return { delta: -quantity, stockNuevo: currentStock - quantity };
  }
  if (operation === "ingreso_fabrica" || operation === "plan_fabrica") {
    return { delta: quantity, stockNuevo: currentStock + quantity };
  }
  if (operation === "stock_fisico") {
    return { delta: quantity - currentStock, stockNuevo: quantity };
  }
  return { delta: 0, stockNuevo: currentStock };
}

/**
 * Simula el impacto neto sobre el stock del catálogo sin ejecutar escrituras.
 */
export function simularImpactoStock(params: {
  operation: IngestionOperation;
  documents: readonly IngestionDocumentInput[];
  catalog: readonly CatalogProductSnapshot[];
  existingNotas?: ReadonlySet<string> | undefined;
  existingHashes?: ReadonlyMap<string, string> | undefined;
  failOnUnmatched?: boolean | undefined;
}): SimulationResult {
  const allowZero = params.operation === "stock_fisico";
  const consolidated = consolidarDocumentos(params.documents, { allowZero });
  const existingNotasLower = new Set(
    Array.from(params.existingNotas ?? []).map((n) => n.trim().toLowerCase())
  );
  const existingHashes = params.existingHashes ?? new Map<string, string>();

  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  const duplicateNotas: string[] = [];
  const duplicateHashes: Array<{
    archivoHash: string;
    existingNotaPedido: string;
  }> = [];

  const seenBatchNotas = new Set<string>();
  const documentSummaries: SimulationDocumentSummary[] = [];

  for (const doc of params.documents) {
    const notaClean = doc.notaPedido.trim();
    const notaLower = notaClean.toLowerCase();
    const hashClean = doc.archivoHash.trim();

    if (
      params.operation === "descuento_pedidos" &&
      (existingNotasLower.has(notaLower) || seenBatchNotas.has(notaLower))
    ) {
      if (!duplicateNotas.includes(notaClean)) {
        duplicateNotas.push(notaClean);
        blockingErrors.push(
          `El remito/pedido '${notaClean}' ya se encuentra registrado o repetido en el lote.`
        );
      }
    }
    seenBatchNotas.add(notaLower);

    if (params.operation === "descuento_pedidos" && hashClean) {
      const existingOrderNota = existingHashes.get(hashClean);
      if (existingOrderNota) {
        duplicateHashes.push({
          archivoHash: hashClean,
          existingNotaPedido: existingOrderNota,
        });
        blockingErrors.push(
          `El comprobante (SHA-256) ya fue procesado en el pedido '${existingOrderNota}'.`
        );
      }
    }

    let articulosExtraidos = 0;
    let itemsMatched = 0;
    let itemsUnmatched = 0;
    for (const item of doc.items) {
      const qty = Math.trunc(item.cantidad);
      if (qty > 0 || (allowZero && qty === 0)) {
        articulosExtraidos += qty;
      }
      if (resolverProductoEnCatalogo(params.catalog, item.codigo)) {
        itemsMatched += 1;
      } else {
        itemsUnmatched += 1;
      }
    }

    const declarados = doc.articulosDeclarados ?? null;
    const verificacionOk =
      declarados === null || declarados === articulosExtraidos;
    if (!verificacionOk) {
      warnings.push(
        `Discrepancia en '${notaClean}': declarados ${declarados}, extraídos ${articulosExtraidos}.`
      );
    }

    documentSummaries.push({
      notaPedido: notaClean,
      cliente: doc.cliente,
      articulosDeclarados: declarados,
      articulosExtraidos,
      verificacionOk,
      itemsMatched,
      itemsUnmatched,
    });
  }

  const matchedItems: SimulationMatchedItem[] = [];
  const unmatchedItems: SimulationUnmatchedItem[] = [];

  for (const item of consolidated.items) {
    const prod = resolverProductoEnCatalogo(params.catalog, item.codigo);
    if (!prod) {
      unmatchedItems.push({
        codigo: item.codigo,
        descripcion: item.descripcion || "Sin descripción",
        cantidad: item.cantidadTotal,
        remitosOrigen: item.remitosOrigen,
        motivo: "Código no encontrado en el catálogo del tenant",
      });
      continue;
    }

    const { delta, stockNuevo } = computeStockImpact(
      params.operation,
      prod.stock,
      item.cantidadTotal
    );

    const quiebre = stockNuevo <= 0;
    const stockCritico = !quiebre && stockNuevo <= prod.stockMinimo;

    matchedItems.push({
      codigoSolicitado: item.codigo,
      codigoCatalogo: prod.code,
      productId: prod.id,
      nombre: prod.name,
      stockAnterior: prod.stock,
      delta,
      stockNuevo,
      stockMinimo: prod.stockMinimo,
      ubicacion: prod.ubicacion,
      quiebre,
      stockCritico,
      remitosOrigen: item.remitosOrigen,
    });
  }

  if (params.failOnUnmatched && unmatchedItems.length > 0) {
    blockingErrors.push(
      `${unmatchedItems.length} artículo(s) no existen en el catálogo del tenant.`
    );
  } else if (unmatchedItems.length > 0) {
    warnings.push(
      `${unmatchedItems.length} artículo(s) sin coincidencia en catálogo serán marcados como pendientes.`
    );
  }

  const quiebres = matchedItems.filter((m) => m.quiebre);
  const criticos = matchedItems.filter((m) => m.stockCritico);

  if (quiebres.length > 0) {
    warnings.push(
      `${quiebres.length} producto(s) quedarían agotados o en stock negativo tras la operación.`
    );
  }

  return {
    operation: params.operation,
    readOnly: true,
    canConfirm: blockingErrors.length === 0,
    blockingErrors,
    warnings,
    totalDocumentos: params.documents.length,
    totalUnidades: consolidated.totalUnidades,
    documentSummaries,
    consolidatedItems: consolidated.items,
    duplicadosConsolidados: consolidated.duplicados,
    matchedItems,
    unmatchedItems,
    quiebres,
    criticos,
    duplicateNotas,
    duplicateHashes,
  };
}

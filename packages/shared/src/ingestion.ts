import { z } from "zod";
import {
  CanalPedidoSchema,
  coincideCodigoOBarras,
  LogisticaSchema,
  normalizarCodigo,
  OrderFileTypeSchema,
} from "./domain.js";

// =============================================================================
// Constantes y Esquemas de Carga, Almacenamiento y Simulación (Fase 2)
// =============================================================================

export const FILE_UPLOAD_CATEGORIES = [
  "remito_mayorista",
  "canje",
  "mercado_libre",
  "mercado_full",
  "ingreso_fabrica",
  "stock_fisico",
  "reporte",
  "etiqueta",
  "adjunto",
] as const;
export type FileUploadCategory = (typeof FILE_UPLOAD_CATEGORIES)[number];

export const STORAGE_DRIVERS = ["local", "s3"] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export const INGESTION_OPERATIONS = [
  "descuento_pedidos",
  "ingreso_fabrica",
  "stock_fisico",
  "plan_full",
  "plan_fabrica",
] as const;
export type IngestionOperation = (typeof INGESTION_OPERATIONS)[number];

export const FileUploadCategorySchema = z.enum(FILE_UPLOAD_CATEGORIES);
export const StorageDriverSchema = z.enum(STORAGE_DRIVERS);
export const IngestionOperationSchema = z.enum(INGESTION_OPERATIONS);

export const StoredFileDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  category: z.string(),
  originalName: z.string(),
  storageKey: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  uploadedBy: z.string(),
  createdAt: z.string(),
  deduplicated: z.boolean().optional(),
});
export type StoredFileDto = z.infer<typeof StoredFileDtoSchema>;

export const RawDocumentItemInputSchema = z.object({
  codigo: z.string().trim().min(1, "El código de producto es obligatorio."),
  descripcion: z.string().default(""),
  cantidad: z.number().int().min(0),
  origenRemito: z.string().default(""),
});
export type RawDocumentItemInput = z.infer<typeof RawDocumentItemInputSchema>;

export const IngestionDocumentInputSchema = z.object({
  sourceFileId: z.string().uuid().optional(),
  notaPedido: z.string().trim().min(1, "El número de nota/remito es obligatorio."),
  numeroPedido: z.string().default(""),
  cliente: z.string().trim().min(1).default("General"),
  bultos: z.number().int().min(1).default(1),
  logistica: LogisticaSchema.default("Domicilio"),
  armador: z.string().default(""),
  tipoArchivo: OrderFileTypeSchema.default("manual"),
  nombreArchivo: z.string().default(""),
  fechaRetiro: z.string().default(""),
  archivoHash: z.string().default(""),
  numeroGuia: z.string().default(""),
  canal: CanalPedidoSchema.optional(),
  articulosDeclarados: z.number().int().min(0).optional(),
  items: z.array(RawDocumentItemInputSchema),
});
export type IngestionDocumentInput = z.infer<
  typeof IngestionDocumentInputSchema
>;

export const ConsolidatedItemSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  cantidadTotal: z.number().int().nonnegative(),
  repeticiones: z.number().int().positive(),
  remitosOrigen: z.array(z.string()),
});
export type ConsolidatedItem = z.infer<typeof ConsolidatedItemSchema>;

export const SimulateIngestionRequestSchema = z.object({
  operation: IngestionOperationSchema.default("descuento_pedidos"),
  documents: z.array(IngestionDocumentInputSchema).min(1),
  failOnUnmatched: z.boolean().default(false),
});
export type SimulateIngestionRequest = z.infer<
  typeof SimulateIngestionRequestSchema
>;

export const ConfirmIngestionRequestSchema = z.object({
  txId: z.string().trim().min(1).max(128).optional(),
  operation: IngestionOperationSchema.default("descuento_pedidos"),
  usuario: z.string().trim().optional(),
  documents: z.array(IngestionDocumentInputSchema).min(1),
  failOnUnmatched: z.boolean().default(false),
  sobrescribirStock: z.boolean().default(false),
});
export type ConfirmIngestionRequest = z.infer<
  typeof ConfirmIngestionRequestSchema
>;

// =============================================================================
// Funciones Puras de Consolidación y Simulación (Paridad consolidator.py)
// =============================================================================

export interface ConsolidationResult {
  items: ConsolidatedItem[];
  duplicados: ConsolidatedItem[];
  totalUnidades: number;
}

/**
 * Agrupa ítems de uno o más documentos por código normalizado, sumando cantidades
 * y conservando la trazabilidad de remitos de origen.
 */
export function consolidarDocumentos(
  documents: ReadonlyArray<{
    notaPedido: string;
    nombreArchivo?: string | undefined;
    items: ReadonlyArray<{
      codigo: string;
      descripcion?: string | undefined;
      cantidad: number;
      origenRemito?: string | undefined;
    }>;
  }>,
  options: { allowZero?: boolean | undefined } = {}
): ConsolidationResult {
  const allowZero = options.allowZero ?? false;
  const agrupados = new Map<string, ConsolidatedItem>();
  let totalUnidades = 0;

  for (const doc of documents) {
    const fallbackOrigen =
      doc.notaPedido.trim() || (doc.nombreArchivo ?? "").trim();

    for (const rawItem of doc.items) {
      const code = normalizarCodigo(rawItem.codigo);
      const qty = Math.trunc(rawItem.cantidad);
      if (!code || qty < 0 || (!allowZero && qty === 0)) {
        continue;
      }

      const key = code.toLowerCase();
      const origen = (rawItem.origenRemito ?? "").trim() || fallbackOrigen;
      const desc = (rawItem.descripcion ?? "").trim();
      totalUnidades += qty;

      const existing = agrupados.get(key);
      if (!existing) {
        agrupados.set(key, {
          codigo: code,
          descripcion: desc,
          cantidadTotal: qty,
          repeticiones: 1,
          remitosOrigen: origen ? [origen] : [],
        });
      } else {
        existing.cantidadTotal += qty;
        existing.repeticiones += 1;
        if (!existing.descripcion && desc) {
          existing.descripcion = desc;
        }
        if (origen && !existing.remitosOrigen.includes(origen)) {
          existing.remitosOrigen.push(origen);
        }
      }
    }
  }

  const items = Array.from(agrupados.values());
  const duplicados = items.filter((it) => it.repeticiones > 1);
  return { items, duplicados, totalUnidades };
}

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

    let delta = 0;
    let stockNuevo = prod.stock;
    if (
      params.operation === "descuento_pedidos" ||
      params.operation === "plan_full"
    ) {
      delta = -item.cantidadTotal;
      stockNuevo = prod.stock - item.cantidadTotal;
    } else if (
      params.operation === "ingreso_fabrica" ||
      params.operation === "plan_fabrica"
    ) {
      delta = item.cantidadTotal;
      stockNuevo = prod.stock + item.cantidadTotal;
    } else if (params.operation === "stock_fisico") {
      stockNuevo = item.cantidadTotal;
      delta = stockNuevo - prod.stock;
    }

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

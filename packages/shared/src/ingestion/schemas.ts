import { z } from "zod";
import {
  CanalPedidoSchema,
  LogisticaSchema,
  OrderFileTypeSchema,
} from "../domain.js";

// =============================================================================
// Constantes y Esquemas de Carga, Almacenamiento y Simulación
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
  notaPedido: z
    .string()
    .trim()
    .min(1, "El número de nota/remito es obligatorio."),
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

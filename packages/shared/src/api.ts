import { z } from "zod";
import {
  EstadoDespachoSchema,
  MovementTypeSchema,
  UserRoleSchema,
} from "./domain.js";

// =============================================================================
// Constantes y Contratos API v1 / Operación Móvil & Tiempo Real (Fase 4)
// =============================================================================

export const QUEUE_DRIVERS = ["memory", "bullmq"] as const;
export type QueueDriver = (typeof QUEUE_DRIVERS)[number];

export const EVENT_BUS_DRIVERS = ["memory", "redis"] as const;
export type EventBusDriver = (typeof EVENT_BUS_DRIVERS)[number];

export const DOMAIN_EVENT_TYPES = [
  "STOCK_UPDATED",
  "PRODUCT_UPDATED",
  "DISPATCH_UPDATED",
  "INVENTORY_FINALIZED",
  "INGESTION_CONFIRMED",
  "CHAT_MESSAGE",
  "NOTIFICATION_CREATED",
  "CLOSURE_COMPLETED",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const QueueDriverSchema = z.enum(QUEUE_DRIVERS);
export const EventBusDriverSchema = z.enum(EVENT_BUS_DRIVERS);
export const DomainEventTypeSchema = z.enum(DOMAIN_EVENT_TYPES);

// --- Auth & Usuarios ---

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1, "El nombre de usuario es obligatorio."),
  password: z.string().min(1, "La contraseña es obligatoria."),
  tenantSlug: z.string().trim().min(1).max(64).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UsuarioResponseSchema = z.object({
  id: z.number().int().nonnegative(),
  username: z.string(),
  role: UserRoleSchema,
  nombre: z.string(),
  email: z.string().default(""),
  tenant_id: z.string().uuid().optional(),
  must_change_password: z.boolean().optional(),
});
export type UsuarioResponse = z.infer<typeof UsuarioResponseSchema>;

export const LoginResponseSchema = z.object({
  ok: z.boolean(),
  token: z.string().optional(),
  user: UsuarioResponseSchema.optional(),
  message: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const CreateUserRequestSchema = z.object({
  username: z.string().trim().min(2).max(64),
  password: z.string().min(1),
  role: UserRoleSchema,
  nombre: z.string().trim().default(""),
  email: z.string().trim().default(""),
  must_change_password: z.boolean().default(false),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  role: UserRoleSchema.optional(),
  active: z.boolean().optional(),
  nombre: z.string().trim().optional(),
  email: z.string().trim().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const CreateApiKeyRequestSchema = z.object({
  client_name: z.string().trim().min(1, "Debe indicar el nombre del cliente."),
  role: UserRoleSchema.default("operador"),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

// --- Productos ---

export const ProductoItemResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
  stock: z.number().int(),
  stock_fisico: z.number().int().default(0),
  stock_minimo: z.number().int().default(0),
  stock_maximo: z.number().int().default(0),
  cod_barras: z.string().default(""),
  ubicacion: z.string().default(""),
  active: z.boolean().default(true),
});
export type ProductoItemResponse = z.infer<typeof ProductoItemResponseSchema>;

export const BuscarProductosResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  productos: z.array(ProductoItemResponseSchema),
});
export type BuscarProductosResponse = z.infer<
  typeof BuscarProductosResponseSchema
>;

export const ActualizarUbicacionRequestSchema = z.object({
  ubicacion: z.string().trim().max(64),
});

export const AsociarBarcodeRequestSchema = z.object({
  cod_barras: z.string().trim().max(128),
});

export const UpsertProductRequestSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(255),
  stock: z.number().int().optional(),
  stock_minimo: z.number().int().min(0).optional(),
  stock_maximo: z.number().int().min(0).optional(),
  cod_barras: z.string().trim().max(128).optional(),
  ubicacion: z.string().trim().max(64).optional(),
  active: z.boolean().optional(),
});
export type UpsertProductRequest = z.infer<typeof UpsertProductRequestSchema>;

export const AdjustStockRequestSchema = z.object({
  delta: z.number().int().refine((v) => v !== 0, "El ajuste debe ser distinto de cero."),
  movement_type: MovementTypeSchema.default("ajuste_manual"),
  detalle: z.string().trim().max(200).optional(),
});

// --- Inventario Físico ---

export const ConteoInventarioRequestSchema = z.object({
  conteo: z
    .record(z.string(), z.number().int().min(0))
    .refine((obj) => Object.keys(obj).length > 0, {
      message: "Debe incluir al menos un producto contado en el diccionario.",
    }),
  nombre_archivo: z.string().trim().optional(),
});

export const InventarioItemComparativaSchema = z.object({
  codigo: z.string(),
  nombre: z.string(),
  stock_sistema: z.number().int(),
  stock_fisico: z.number().int(),
  diferencia: z.number().int(),
  estado: z.enum(["COINCIDE", "FALTANTE", "SOBRANTE", "NO_CATALOGADO"]),
});
export type InventarioItemComparativa = z.infer<
  typeof InventarioItemComparativaSchema
>;

export const InventarioResultadoResponseSchema = z.object({
  ok: z.boolean(),
  mensaje: z.string(),
  total_items: z.number().int().nonnegative(),
  coinciden: z.number().int().nonnegative(),
  faltantes: z.number().int().nonnegative(),
  sobrantes: z.number().int().nonnegative(),
  archivo_generado: z.string().nullable().default(null),
  comparativa: z.array(InventarioItemComparativaSchema),
});

// --- Despacho y Pedidos ---

export const ItemPedidoResponseSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  cantidad: z.number().int().positive(),
});

export const PedidoDetalleResponseSchema = z.object({
  id: z.number().int(),
  nota_pedido: z.string(),
  numero_pedido: z.string().default(""),
  cliente: z.string(),
  bultos: z.number().int().min(1),
  logistica: z.string().default(""),
  armador: z.string().default(""),
  estado_despacho: z.string(),
  created_at: z.string(),
  despachado_at: z.string().default(""),
  despachado_por: z.string().default(""),
  entregado_at: z.string().default(""),
  entregado_por: z.string().default(""),
  items: z.array(ItemPedidoResponseSchema).default([]),
});
export type PedidoDetalleResponse = z.infer<typeof PedidoDetalleResponseSchema>;

export const EscanearDespachoRequestSchema = z.object({
  codigo: z.string().trim().min(1, "Debe especificar un código QR o remito."),
  nuevo_estado: EstadoDespachoSchema.optional(),
});

export const EscanearLoteRequestSchema = z.object({
  items: z.array(EscanearDespachoRequestSchema).min(1).max(200),
});

// --- Chat, Notificaciones & Operación ---

export const SendChatMessageRequestSchema = z.object({
  mensaje: z.string().trim().min(1).max(2000),
  destinatario: z.string().trim().max(64).default("Todos"),
});

export const ShiftClosureRequestSchema = z.object({
  order_ids: z.array(z.number().int().positive()).min(1),
});

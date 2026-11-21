import { z } from "zod";
import {
  CANAL_PEDIDO_OPCIONES,
  ESTADOS_DESPACHO,
  INVENTORY_HEALTH_STATES,
  LOGISTICA_OPCIONES,
  MOVEMENT_TYPES,
  ORDER_FILE_TYPES,
  ORDER_STATUSES,
  PLAN_STATUSES,
  TENANT_PLANS,
  USER_ROLES,
  WEBHOOK_EVENTS,
} from "./constants.js";

export const UserRoleSchema = z.enum(USER_ROLES);
export const TenantPlanSchema = z.enum(TENANT_PLANS);
export const LogisticaSchema = z.enum(LOGISTICA_OPCIONES);
export const EstadoDespachoSchema = z.enum(ESTADOS_DESPACHO);
export const CanalPedidoSchema = z.enum(CANAL_PEDIDO_OPCIONES);
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export const OrderFileTypeSchema = z.enum(ORDER_FILE_TYPES);
export const MovementTypeSchema = z.enum(MOVEMENT_TYPES);
export const PlanStatusSchema = z.enum(PLAN_STATUSES);
export const WebhookEventSchema = z.enum(WEBHOOK_EVENTS);
export const InventoryHealthStateSchema = z.enum(INVENTORY_HEALTH_STATES);

export const TenantSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(2).max(64),
  name: z.string().min(1).max(120),
  plan: TenantPlanSchema,
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TenantDto = z.infer<typeof TenantSchema>;

export const UserSchema = z.object({
  id: z.number().int().positive(),
  tenantId: z.string().uuid(),
  username: z.string().min(2).max(64),
  role: UserRoleSchema,
  active: z.boolean(),
  mustChangePassword: z.boolean(),
  nombre: z.string(),
  email: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserDto = z.infer<typeof UserSchema>;

export const ProductSchema = z.object({
  id: z.number().int().positive(),
  tenantId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  stock: z.number().int(),
  stockMinimo: z.number().int().min(0),
  stockMaximo: z.number().int().min(0),
  stockFisico: z.number().int().nullable(),
  codBarras: z.string(),
  ubicacion: z.string(),
  displayOrder: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductDto = z.infer<typeof ProductSchema>;

export const CustomerSchema = z.object({
  id: z.number().int().positive(),
  tenantId: z.string().uuid(),
  nombre: z.string().min(1).max(120),
  codigo: z.string(),
  direccion: z.string(),
  activo: z.boolean(),
  createdAt: z.string(),
});
export type CustomerDto = z.infer<typeof CustomerSchema>;

export const OrderItemInputSchema = z.object({
  codigo: z.string().min(1),
  descripcion: z.string().default(""),
  cantidad: z.number().int().positive(),
});
export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;

export const OrderSchema = z.object({
  id: z.number().int().positive(),
  tenantId: z.string().uuid(),
  notaPedido: z.string().min(1),
  numeroPedido: z.string(),
  cliente: z.string().min(1),
  bultos: z.number().int().min(1),
  logistica: LogisticaSchema,
  armador: z.string(),
  tipoArchivo: OrderFileTypeSchema,
  nombreArchivo: z.string(),
  agregado: z.boolean(),
  articulosDescontados: z.number().int(),
  resumenItems: z.string(),
  estado: OrderStatusSchema,
  fechaRetiro: z.string(),
  archivoDescuento: z.string(),
  cierreId: z.number().int().nullable(),
  cierreMercadoId: z.number().int().nullable(),
  archivoHash: z.string(),
  numeroGuia: z.string(),
  estadoDespacho: EstadoDespachoSchema,
  despachadoAt: z.string(),
  despachadoPor: z.string(),
  entregadoAt: z.string(),
  entregadoPor: z.string(),
  canal: CanalPedidoSchema,
  createdAt: z.string(),
});
export type OrderDto = z.infer<typeof OrderSchema>;

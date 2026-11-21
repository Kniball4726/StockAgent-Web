// =============================================================================
// Constantes y Enumeraciones de Dominio (alineadas con StockAgent base)
// =============================================================================

export const USER_ROLES = [
  "master",
  "administrador",
  "operador",
  "consulta",
  "picker",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TENANT_PLANS = ["free", "pro", "enterprise"] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const LOGISTICA_OPCIONES = [
  "Domicilio",
  "Centro de distribución",
  "Transporte",
  "Comisionista",
  "Mabel",
  "Canje",
] as const;
export type LogisticaOpcion = (typeof LOGISTICA_OPCIONES)[number];

export const ESTADOS_DESPACHO = ["armado", "despachado", "entregado"] as const;
export type EstadoDespacho = (typeof ESTADOS_DESPACHO)[number];

export const CANAL_PEDIDO_OPCIONES = [
  "mayorista",
  "mercado_libre",
  "full",
  "canje",
  "otro",
] as const;
export type CanalPedido = (typeof CANAL_PEDIDO_OPCIONES)[number];

export const ORDER_STATUSES = ["descontado", "anulado"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_FILE_TYPES = ["pdf", "excel", "docx", "manual"] as const;
export type OrderFileType = (typeof ORDER_FILE_TYPES)[number];

export const MOVEMENT_TYPES = [
  "descuento",
  "ingreso_fabrica",
  "ingreso_rapido",
  "salida_rapida",
  "ajuste_manual",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const PLAN_STATUSES = [
  "pendiente",
  "en_proceso",
  "completado",
  "cancelado",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const WEBHOOK_EVENTS = [
  "QUIEBRE_STOCK",
  "CIERRE_JORNADA",
  "MOVIMIENTO_RAPIDO",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const INVENTORY_HEALTH_STATES = [
  "AGOTADO",
  "QUIEBRE_INMINENTE",
  "OPTIMO",
  "SOBRESTOCK",
] as const;
export type InventoryHealthState = (typeof INVENTORY_HEALTH_STATES)[number];

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_ITERATIONS = 600_000;
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 15 * 60;

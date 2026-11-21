import { z } from "zod";

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

// =============================================================================
// Funciones Puras de Dominio (SKU / Barcode Wedge / Canales)
// =============================================================================

/**
 * Limpia un código numérico o SKU removiendo espacios y sufijos `.0`.
 */
export function normalizarCodigo(raw: unknown): string {
  if (raw === null || raw === undefined || typeof raw === "boolean") {
    return "";
  }
  const text =
    typeof raw === "number"
      ? Number.isFinite(raw)
        ? Number.isInteger(raw)
          ? String(Math.trunc(raw))
          : String(raw)
        : ""
      : String(raw);
  const trimmed = text.trim();
  return trimmed.replace(/^(-?\d+)\.0+$/, "$1");
}

/**
 * Normaliza lecturas provenientes de pistolas HID / colectores / escáner cámara.
 * Elimina prefijos AIM (`]C1`, `]e0`), caracteres de control y delimitadores Code-39 `*...*`.
 */
export function normalizarCodigoLector(raw: unknown): string {
  if (raw === null || raw === undefined || typeof raw === "boolean") {
    return "";
  }

  let text = "";
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return "";
    }
    text = Number.isInteger(raw) ? String(Math.trunc(raw)) : String(raw);
  } else {
    text = String(raw);
  }

  text = text.trim();
  if (!text) {
    return "";
  }

  // Eliminar prefijo estándar AIM Symbology Identifier (ej. ]C1, ]e0, ]E0)
  text = text.replace(/^\][A-Za-z][0-9]/, "");

  // Eliminar caracteres ASCII de control no imprimibles (0x00..0x1F y 0x7F)
  let printable = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if ((code >= 32 && code <= 126) || code > 127) {
      printable += ch;
    }
  }
  text = printable.trim();

  // Eliminar delimitadores Start/Stop de Code 39 (*CODIGO*)
  if (text.length >= 3 && text.startsWith("*") && text.endsWith("*")) {
    text = text.slice(1, -1).trim();
  }

  return text.replace(/^(-?\d+)\.0+$/, "$1").trim();
}

/**
 * Genera variantes ordenadas para matching tolerante a teclado HID US->ES/LA y EAN-13/UPC-A.
 */
export function generarVariantesCodigoLector(raw: unknown): string[] {
  const base = normalizarCodigoLector(raw);
  if (!base) {
    return [];
  }

  const variantes: string[] = [];
  const vistos = new Set<string>();

  const agregar = (candidato: string) => {
    const limpio = candidato.trim();
    if (limpio && !vistos.has(limpio)) {
      vistos.add(limpio);
      variantes.push(limpio);
    }
  };

  agregar(base);

  const basesTeclado: string[] = [base];
  const sinAimEs = base.replace(/^[+}´][A-Za-z][0-9]/, "").trim();
  if (sinAimEs && sinAimEs !== base) {
    agregar(sinAimEs);
    basesTeclado.push(sinAimEs);
  }

  for (let i = 0; i < basesTeclado.length; i += 1) {
    const origen = basesTeclado[i];
    if (!origen) {
      continue;
    }
    if (origen.includes("'") || origen.includes("?")) {
      const corregido = origen.replaceAll("'", "-").replaceAll("?", "_");
      agregar(corregido);
      if (!basesTeclado.includes(corregido)) {
        basesTeclado.push(corregido);
      }
    }
    const sinEspacios = origen.replace(/\s+/g, "");
    if (sinEspacios !== origen) {
      agregar(sinEspacios);
      if (!basesTeclado.includes(sinEspacios)) {
        basesTeclado.push(sinEspacios);
      }
    }
  }

  const actuales = [...variantes];
  for (const cand of actuales) {
    if (/^\d+$/.test(cand)) {
      if (cand.length === 13 && cand.startsWith("0")) {
        agregar(cand.slice(1));
      } else if (cand.length === 12) {
        agregar(`0${cand}`);
      }
      const sinCeros = cand.replace(/^0+/, "") || "0";
      agregar(sinCeros);
    }
  }

  return variantes;
}

export function coincideCodigoOBarras(
  producto: { code?: string | null; codBarras?: string | null; cod_barras?: string | null },
  rawQuery: unknown
): boolean {
  const variantesQuery = generarVariantesCodigoLector(rawQuery);
  if (variantesQuery.length === 0) {
    return false;
  }

  const candidatosProd = new Set<string>();
  const fields = [producto.code, producto.codBarras ?? producto.cod_barras];
  for (const field of fields) {
    for (const variant of generarVariantesCodigoLector(field)) {
      candidatosProd.add(variant.toLowerCase());
    }
  }

  return variantesQuery.some((v) => candidatosProd.has(v.toLowerCase()));
}

export interface ClasificarCanalInput {
  tipoArchivo?: string | undefined;
  cliente?: string | undefined;
  nombreArchivo?: string | undefined;
  notaPedido?: string | undefined;
  logistica?: string | undefined;
  canalExplicito?: string | undefined;
}

/**
 * Clasifica determinísticamente el canal operativo de un pedido.
 */
export function clasificarCanalPedido(input: ClasificarCanalInput): CanalPedido {
  const canalClean = (input.canalExplicito ?? "").trim().toLowerCase();
  if ((CANAL_PEDIDO_OPCIONES as readonly string[]).includes(canalClean)) {
    return canalClean as CanalPedido;
  }

  const tipo = (input.tipoArchivo ?? "").trim().toLowerCase();
  const cli = (input.cliente ?? "").trim().toLowerCase();
  const arch = (input.nombreArchivo ?? "").trim().toLowerCase();
  const nota = (input.notaPedido ?? "").trim().toLowerCase();
  const log = (input.logistica ?? "").trim().toLowerCase();
  const texto = `${cli} ${arch} ${nota}`;

  if (texto.includes("full")) {
    return "full";
  }
  if (
    tipo === "docx" ||
    cli.includes("mercado libre") ||
    nota.startsWith("ml") ||
    arch.startsWith("ml_")
  ) {
    return "mercado_libre";
  }
  if (log === "canje" || tipo === "excel") {
    return "canje";
  }
  if (tipo === "pdf" || cli.length > 0 || nota.length > 0) {
    return "mayorista";
  }
  return "otro";
}

// =============================================================================
// Esquemas Zod Compartidos (Contratos Dominio / DTOs)
// =============================================================================

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

import type {
  IngestionDocumentInput,
  IngestionOperation,
  InventarioItemComparativa,
  SimulationResult,
  StoredFileDto,
  UserRole,
} from "@stockagent/shared";

export interface InventarioResultadoResponse {
  ok: boolean;
  mensaje: string;
  total_items: number;
  coinciden: number;
  faltantes: number;
  sobrantes: number;
  archivo_generado: string | null;
  comparativa: InventarioItemComparativa[];
}

export interface SystemEstadoResponse {
  ok: boolean;
  version: string;
  servidor_hora: string;
  ip_local: string;
  sesiones_activas: number;
  websocket_clientes?: number;
  modo_conexion: string;
  queue_driver?: string;
  event_bus_driver?: string;
}

export interface SafeUserRow {
  id: number;
  tenantId: string;
  username: string;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  nombre: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantApiKeyRow {
  keyHash: string;
  tenantId: string;
  clientName: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  lastUsed: string | null;
}

export interface ReplenishmentItemDto {
  id: number;
  code: string;
  name: string;
  stock: number;
  stockMinimo: number;
  stockMaximo: number;
  ubicacion: string;
  estadoInventario: "AGOTADO" | "QUIEBRE_INMINENTE" | "OPTIMO" | "SOBRESTOCK";
  cantidadSugeridaPedir: number;
}

export interface StockMovementRow {
  id: number;
  productCode: string;
  productName: string;
  quantity: number;
  movementType: string;
  usuario: string;
  detalle: string;
  registeredAt: string;
}

export interface ChatMessageRow {
  id: number;
  emisor: string;
  destinatario: string;
  mensaje: string;
  leido: boolean;
  createdAt: string;
}

export interface AdminNotificationRow {
  id: number;
  title: string;
  message: string;
  operatorUsername: string;
  notificationType: string;
  details: string;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogRow {
  id: number;
  usuario: string;
  accion: string;
  detalle: string;
  createdAt: string;
}

export interface ParsedEnvelopeDto {
  file: StoredFileDto;
  parseType: string;
  document: IngestionDocumentInput;
  warnings: string[];
  stats: Record<string, unknown>;
}

export interface UploadAndSimulateResponse {
  ok: boolean;
  operation: IngestionOperation;
  uploadedFiles: Array<{ file: StoredFileDto; duplicateOfOrder: string | null }>;
  parsedDocuments: ParsedEnvelopeDto[];
  simulation: SimulationResult;
}

export interface ConfirmIngestionResultDto {
  txId: string;
  operation: IngestionOperation;
  idempotentReplay: boolean;
  ordersCreated: Array<{
    id: number;
    notaPedido: string;
    totalArticulos: number;
  }>;
  totalUnidadesAplicadas: number;
  matchedItems: number;
  unmatchedItems: Array<{ codigo: string; descripcion: string; cantidad: number }>;
  auditDetail: string;
}

export interface MaskedMercadoLibreConfigDto {
  appId: string;
  sellerId: string;
  activo: boolean;
  filtroEstado: string;
  horasAtras: number;
  autoDescontar: boolean;
  ultimaSincronizacion: string;
  hasClientSecret: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
}

export interface MercadoLibreConfigPatch {
  appId?: string;
  clientSecret?: string;
  sellerId?: string;
  accessToken?: string;
  refreshToken?: string;
  activo?: boolean;
  filtroEstado?: string;
  horasAtras?: number;
  autoDescontar?: boolean;
}

export interface MappedMercadoLibreOrderDto {
  ordenId: string;
  refPedido: string;
  cliente: string;
  fecha: string;
  shippingId: string;
  totalUnidades: number;
  totalImporte: number;
  todosCoinciden: boolean;
  stockSuficiente: boolean;
  itemsCoincidentes: Array<{
    codigo: string;
    nombre: string;
    cantidad: number;
    stockActual: number;
    metodo: "SKU" | "Fuzzy Título";
    stockSuficiente: boolean;
  }>;
  itemsNoCoincidentes: Array<{
    titulo: string;
    sku: string;
    cantidad: number;
    motivo: string;
  }>;
}

export interface SyncMercadoLibreResponse {
  ok: boolean;
  simulateOnly: boolean;
  totalFetched: number;
  mappedOrders: MappedMercadoLibreOrderDto[];
  skippedAlreadyProcessed: string[];
  simulation: SimulationResult;
  confirmResult?: ConfirmIngestionResultDto;
}

export interface SaasUsageResponse {
  ok: boolean;
  tenant: {
    id: string;
    slug: string;
    name: string;
    plan: string;
    active: boolean;
  };
  quotas: {
    plan: string;
    maxUsers: number;
    maxProducts: number;
    maxStorageBytes: number;
    allowApiKeys: boolean;
    allowMercadoLibre: boolean;
  };
  usage: {
    usersCount: number;
    productsCount: number;
    storageBytes: number;
  };
  withinLimits: boolean;
}

export interface TenantBackupExportResponse {
  ok: boolean;
  snapshot: {
    formatVersion: number;
    tenantId: string;
    tenantSlug: string;
    exportedAt: string;
    sha256Checksum: string;
    counts: Record<string, number>;
    data: Record<string, unknown>;
  };
}

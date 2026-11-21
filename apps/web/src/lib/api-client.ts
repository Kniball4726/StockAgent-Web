import type {
  BuscarProductosResponse,
  ConfirmIngestionRequest,
  CreateApiKeyRequest,
  CreateUserRequest,
  FileUploadCategory,
  IngestionDocumentInput,
  IngestionOperation,
  InventarioItemComparativa,
  LoginRequest,
  LoginResponse,
  PedidoDetalleResponse,
  ProductoItemResponse,
  SimulationResult,
  StoredFileDto,
  UpdateUserRequest,
  UpsertProductRequest,
  UserRole,
  UsuarioResponse,
} from "@stockagent/shared";
import type {
  DispatchBatchResponse,
  DispatchStatusTarget,
} from "./offline-dispatch-queue";

const API_URL_STORAGE_KEY = "stockagent_api_url";

export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed;
}

export function getSavedApiBaseUrlOverride(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return normalizeApiBaseUrl(window.localStorage.getItem(API_URL_STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
}

export function saveApiBaseUrlOverride(url: string): string {
  const normalized = normalizeApiBaseUrl(url);
  if (typeof window !== "undefined") {
    try {
      if (!normalized) {
        window.localStorage.removeItem(API_URL_STORAGE_KEY);
      } else {
        window.localStorage.setItem(API_URL_STORAGE_KEY, normalized);
      }
    } catch {
      // Ignorar fallos de almacenamiento privado
    }
  }
  return normalized;
}

export function resolveEffectiveApiBaseUrl(): string {
  const override = getSavedApiBaseUrlOverride();
  if (override) {
    return override;
  }

  // En desarrollo Vite usamos proxy mismo-origen (`/api` -> backend) para evitar CORS y soportar LAN móvil
  if (import.meta.env.DEV) {
    return "";
  }

  const configured = normalizeApiBaseUrl(import.meta.env.VITE_API_URL ?? "");
  if (!configured) {
    return "";
  }

  if (typeof window !== "undefined") {
    const isLocalHost =
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost";
    const configuredIsLocal =
      configured.includes("127.0.0.1") || configured.includes("localhost");
    if (!isLocalHost && configuredIsLocal) {
      return "";
    }
  }

  return configured;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly isNetworkError: boolean;
  readonly issues?: unknown;

  constructor(params: {
    message: string;
    status?: number;
    code?: string;
    isNetworkError?: boolean;
    issues?: unknown;
  }) {
    super(params.message);
    this.name = "ApiClientError";
    this.status = params.status ?? 0;
    this.code = params.code ?? "API_ERROR";
    this.isNetworkError = Boolean(params.isNetworkError);
    if (params.issues !== undefined) {
      this.issues = params.issues;
    }
  }
}

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

export interface ApiClientOptions {
  baseUrl?: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export class StockAgentApiClient {
  private baseUrl: string;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized?: () => void;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = normalizeApiBaseUrl(
      options.baseUrl ?? resolveEffectiveApiBaseUrl()
    );
    this.getToken = options.getToken;
    if (options.onUnauthorized) {
      this.onUnauthorized = options.onUnauthorized;
    }
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  setBaseUrl(nextUrl: string): void {
    this.baseUrl = normalizeApiBaseUrl(nextUrl);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private buildUrl(path: string): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${cleanPath}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    opts: { skipAuthRedirect?: boolean } = {}
  ): Promise<T> {
    const headers = new Headers(init.headers);
    const token = this.getToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const isFormData =
      typeof FormData !== "undefined" && init.body instanceof FormData;
    if (!isFormData && init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.buildUrl(path), {
        ...init,
        headers,
      });
    } catch (error) {
      throw new ApiClientError({
        message:
          error instanceof Error
            ? `Sin conexión con el servidor (${error.message}).`
            : "Sin conexión con el servidor.",
        isNetworkError: true,
        code: "NETWORK_ERROR",
      });
    }

    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    if (text.trim().length > 0) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      if (response.status === 401 && !opts.skipAuthRedirect) {
        this.onUnauthorized?.();
      }
      const errObj =
        data?.error && typeof data.error === "object"
          ? (data.error as Record<string, unknown>)
          : null;
      const msg = String(
        data?.detail ??
          data?.message ??
          errObj?.message ??
          `Error HTTP ${response.status}`
      );
      const code = String(errObj?.code ?? `HTTP_${response.status}`);
      throw new ApiClientError({
        message: msg,
        status: response.status,
        code,
        isNetworkError: response.status >= 502,
        issues: errObj?.issues,
      });
    }

    return (data ?? {}) as T;
  }

  // Sistema & Salud
  ping(): Promise<{ status: string; timestamp: string }> {
    return this.request("/api/v1/sistema/ping", { method: "GET" }, { skipAuthRedirect: true });
  }

  getSystemStatus(): Promise<SystemEstadoResponse> {
    return this.request("/api/v1/sistema/estado", { method: "GET" }, { skipAuthRedirect: true });
  }

  // Auth & Usuarios & API Keys
  login(payload: LoginRequest): Promise<LoginResponse> {
    return this.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      { skipAuthRedirect: true }
    );
  }

  getMe(): Promise<UsuarioResponse> {
    return this.request("/api/v1/auth/me", { method: "GET" });
  }

  logout(): Promise<{ ok: boolean; message: string }> {
    return this.request("/api/v1/auth/logout", { method: "POST" }, { skipAuthRedirect: true });
  }

  changePassword(current_password: string, new_password: string): Promise<{ ok: boolean; message: string }> {
    return this.request("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    });
  }

  listUsers(): Promise<{ ok: boolean; users: SafeUserRow[] }> {
    return this.request("/api/v1/auth/users", { method: "GET" });
  }

  createUser(payload: CreateUserRequest): Promise<{ ok: boolean; user: SafeUserRow }> {
    return this.request("/api/v1/auth/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateUser(id: number, payload: UpdateUserRequest): Promise<{ ok: boolean; user: SafeUserRow }> {
    return this.request(`/api/v1/auth/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  listApiKeys(): Promise<{ ok: boolean; api_keys: TenantApiKeyRow[] }> {
    return this.request("/api/v1/auth/api-keys", { method: "GET" });
  }

  createApiKey(
    payload: CreateApiKeyRequest
  ): Promise<{ ok: boolean; api_key: string; key_hash: string; role: UserRole }> {
    return this.request("/api/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  revokeApiKey(keyHash: string): Promise<{ ok: boolean; message: string }> {
    return this.request(`/api/v1/auth/api-keys/${encodeURIComponent(keyHash)}`, {
      method: "DELETE",
    });
  }

  // Productos, Reposición & Movimientos
  searchProducts(q = "", limit = 100): Promise<BuscarProductosResponse> {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    params.set("limit", String(limit));
    return this.request(`/api/v1/productos/buscar?${params.toString()}`, {
      method: "GET",
    });
  }

  getProduct(codeOrBarcode: string): Promise<ProductoItemResponse> {
    return this.request(
      `/api/v1/productos/${encodeURIComponent(codeOrBarcode)}`,
      { method: "GET" }
    );
  }

  upsertProduct(payload: UpsertProductRequest): Promise<{ ok: boolean; producto: ProductoItemResponse }> {
    return this.request("/api/v1/productos", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  adjustProductStock(
    code: string,
    payload: {
      delta: number;
      movement_type:
        | "descuento"
        | "ingreso_fabrica"
        | "ingreso_rapido"
        | "salida_rapida"
        | "ajuste_manual";
      detalle?: string;
    }
  ): Promise<{ ok: boolean; code: string; stock_anterior: number; stock_nuevo: number }> {
    return this.request(`/api/v1/productos/${encodeURIComponent(code)}/ajustar`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateProductLocation(
    code: string,
    ubicacion: string
  ): Promise<{ ok: boolean; code: string; ubicacion: string }> {
    return this.request(
      `/api/v1/productos/${encodeURIComponent(code)}/ubicacion`,
      {
        method: "PUT",
        body: JSON.stringify({ ubicacion }),
      }
    );
  }

  associateProductBarcode(
    code: string,
    cod_barras: string
  ): Promise<{ ok: boolean; code: string; cod_barras: string }> {
    return this.request(
      `/api/v1/productos/${encodeURIComponent(code)}/codigo-barras`,
      {
        method: "PUT",
        body: JSON.stringify({ cod_barras }),
      }
    );
  }

  getReplenishmentAnalysis(
    soloCriticos = false
  ): Promise<{ ok: boolean; total: number; items: ReplenishmentItemDto[] }> {
    return this.request(
      `/api/v1/productos/reposicion/analisis?solo_criticos=${soloCriticos}`,
      { method: "GET" }
    );
  }

  getMovementsHistory(
    limit = 100
  ): Promise<{ ok: boolean; total: number; movimientos: StockMovementRow[] }> {
    return this.request(
      `/api/v1/productos/movimientos/historial?limit=${limit}`,
      { method: "GET" }
    );
  }

  // Inventario físico en vivo
  comparePreliminaryInventory(
    conteo: Record<string, number>,
    nombreArchivo?: string
  ): Promise<InventarioResultadoResponse> {
    return this.request("/api/v1/inventario/comparar-preliminar", {
      method: "POST",
      body: JSON.stringify({
        conteo,
        ...(nombreArchivo ? { nombre_archivo: nombreArchivo } : {}),
      }),
    });
  }

  finalizePhysicalInventory(
    conteo: Record<string, number>,
    nombreArchivo?: string
  ): Promise<InventarioResultadoResponse> {
    return this.request("/api/v1/inventario/finalizar", {
      method: "POST",
      body: JSON.stringify({
        conteo,
        ...(nombreArchivo ? { nombre_archivo: nombreArchivo } : {}),
      }),
    });
  }

  // Despacho QR online & lote
  listDispatchOrders(
    estadoDespacho = "",
    limit = 100
  ): Promise<{ total: number; pedidos: PedidoDetalleResponse[] }> {
    const params = new URLSearchParams();
    if (estadoDespacho) params.set("estado_despacho", estadoDespacho);
    params.set("limit", String(limit));
    return this.request(`/api/v1/despacho/pedidos?${params.toString()}`, {
      method: "GET",
    });
  }

  getDispatchOrder(notaPedido: string): Promise<PedidoDetalleResponse> {
    return this.request(
      `/api/v1/despacho/pedidos/${encodeURIComponent(notaPedido)}`,
      { method: "GET" }
    );
  }

  scanDispatch(
    codigo: string,
    nuevo_estado?: DispatchStatusTarget
  ): Promise<{ ok: boolean; mensaje: string; pedido: PedidoDetalleResponse }> {
    return this.request("/api/v1/despacho/escanear", {
      method: "POST",
      body: JSON.stringify({
        codigo,
        ...(nuevo_estado ? { nuevo_estado } : {}),
      }),
    });
  }

  scanDispatchBatch(
    items: Array<{ codigo: string; nuevo_estado?: DispatchStatusTarget }>
  ): Promise<DispatchBatchResponse> {
    return this.request("/api/v1/despacho/escanear-lote", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  }

  acquireOrderLock(orderId: number): Promise<{ ok: boolean; acquired: boolean; lockedBy?: string }> {
    return this.request(`/api/v1/despacho/pedidos/${orderId}/lock`, {
      method: "POST",
    });
  }

  releaseOrderLock(orderId: number): Promise<{ ok: boolean }> {
    return this.request(`/api/v1/despacho/pedidos/${orderId}/lock`, {
      method: "DELETE",
    });
  }

  // Archivos, Parsers & Ingesta Transaccional
  listStoredFiles(
    category = "",
    limit = 50
  ): Promise<{ ok: boolean; files: StoredFileDto[] }> {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    params.set("limit", String(limit));
    return this.request(`/api/v1/files?${params.toString()}`, { method: "GET" });
  }

  deleteStoredFile(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/v1/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async downloadStoredFile(id: string): Promise<Blob> {
    const headers = new Headers();
    const token = this.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await this.fetchImpl(
      this.buildUrl(`/api/v1/files/${encodeURIComponent(id)}/content?download=true`),
      { method: "GET", headers }
    );
    if (!response.ok) {
      if (response.status === 401) {
        this.onUnauthorized?.();
      }
      throw new ApiClientError({
        message: `No se pudo descargar el archivo (${response.status}).`,
        status: response.status,
      });
    }
    return response.blob();
  }

  uploadAndSimulate(params: {
    category: FileUploadCategory;
    files: File[];
    operation?: IngestionOperation;
    failOnUnmatched?: boolean;
  }): Promise<UploadAndSimulateResponse> {
    const formData = new FormData();
    formData.set("category", params.category);
    if (params.operation) {
      formData.set("operation", params.operation);
    }
    if (params.failOnUnmatched !== undefined) {
      formData.set("failOnUnmatched", String(params.failOnUnmatched));
    }
    for (const file of params.files) {
      formData.append("file", file, file.name);
    }
    return this.request("/api/v1/parsers/upload-and-simulate", {
      method: "POST",
      body: formData,
    });
  }

  confirmIngestion(
    payload: Omit<ConfirmIngestionRequest, "failOnUnmatched" | "sobrescribirStock"> & {
      failOnUnmatched?: boolean;
      sobrescribirStock?: boolean;
    },
    idempotencyKey?: string
  ): Promise<{ ok: boolean; result: ConfirmIngestionResultDto }> {
    return this.request("/api/v1/ingestion/confirm", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
      body: JSON.stringify(payload),
    });
  }

  // Chat, Notificaciones & Auditoría
  listChatMessages(limit = 60): Promise<{ ok: boolean; mensajes: ChatMessageRow[] }> {
    return this.request(`/api/v1/chat/mensajes?limit=${limit}`, { method: "GET" });
  }

  sendChatMessage(
    mensaje: string,
    destinatario = "Todos"
  ): Promise<{ ok: boolean; mensaje: ChatMessageRow }> {
    return this.request("/api/v1/chat/mensajes", {
      method: "POST",
      body: JSON.stringify({ mensaje, destinatario }),
    });
  }

  markChatRead(): Promise<{ ok: boolean }> {
    return this.request("/api/v1/chat/marcar-leidos", { method: "POST" });
  }

  listNotifications(
    soloNoLeidas = false,
    limit = 40
  ): Promise<{ ok: boolean; notificaciones: AdminNotificationRow[] }> {
    return this.request(
      `/api/v1/notificaciones?solo_no_leidas=${soloNoLeidas}&limit=${limit}`,
      { method: "GET" }
    );
  }

  markNotificationsRead(id?: number): Promise<{ ok: boolean }> {
    return this.request("/api/v1/notificaciones/leer", {
      method: "POST",
      body: JSON.stringify(id !== undefined ? { id } : {}),
    });
  }

  listAuditLogs(limit = 80): Promise<{ ok: boolean; logs: AuditLogRow[] }> {
    return this.request(`/api/v1/auditoria?limit=${limit}`, { method: "GET" });
  }

  // Mercado Libre
  getMercadoLibreConfig(): Promise<{
    ok: boolean;
    config: MaskedMercadoLibreConfigDto;
  }> {
    return this.request("/api/v1/integrations/mercadolibre/config", {
      method: "GET",
    });
  }

  updateMercadoLibreConfig(patch: {
    appId?: string;
    clientSecret?: string;
    sellerId?: string;
    accessToken?: string;
    refreshToken?: string;
    activo?: boolean;
    filtroEstado?: string;
    horasAtras?: number;
    autoDescontar?: boolean;
  }): Promise<{ ok: boolean; config: MaskedMercadoLibreConfigDto }> {
    return this.request("/api/v1/integrations/mercadolibre/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  }

  getMercadoLibreOAuthUrl(
    redirectUri: string,
    state = ""
  ): Promise<{ ok: boolean; url: string }> {
    const params = new URLSearchParams({ redirectUri });
    if (state) params.set("state", state);
    return this.request(
      `/api/v1/integrations/mercadolibre/oauth-url?${params.toString()}`,
      { method: "GET" }
    );
  }

  submitMercadoLibreOAuthCallback(
    code: string,
    redirectUri: string
  ): Promise<{ ok: boolean; sellerId: string }> {
    return this.request("/api/v1/integrations/mercadolibre/oauth-callback", {
      method: "POST",
      body: JSON.stringify({ code, redirectUri }),
    });
  }

  verifyMercadoLibre(): Promise<{ ok: boolean; nickname?: string; sellerId?: string }> {
    return this.request("/api/v1/integrations/mercadolibre/verify", {
      method: "POST",
    });
  }

  syncMercadoLibreOrders(simulateOnly = true): Promise<SyncMercadoLibreResponse> {
    return this.request("/api/v1/integrations/mercadolibre/orders/sync", {
      method: "POST",
      body: JSON.stringify({ simulateOnly }),
    });
  }

  getSaasUsage(): Promise<{
    ok: boolean;
    tenant: { id: string; slug: string; name: string; plan: string; active: boolean };
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
  }> {
    return this.request("/api/v1/saas/usage", { method: "GET" });
  }

  exportTenantBackup(): Promise<{
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
  }> {
    return this.request("/api/v1/saas/backup/export", { method: "POST" });
  }
}

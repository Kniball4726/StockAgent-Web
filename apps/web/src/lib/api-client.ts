import type {
  CreateApiKeyRequest,
  CreateUserRequest,
  FileUploadCategory,
  IngestionOperation,
  LoginRequest,
  UpdateUserRequest,
  UpsertProductRequest,
} from "@stockagent/shared";
import type { DispatchStatusTarget } from "./offline-dispatch-queue";
import { AdminIntegrationsApi } from "./api/admin-ml-api";
import { AuthSystemApi } from "./api/auth-api";
import { CatalogInventoryApi } from "./api/catalog-api";
import { DispatchApi } from "./api/dispatch-api";
import {
  ApiClientError,
  BaseHttpClient,
  type ApiClientOptions,
} from "./api/http-client";
import { FilesIngestionApi } from "./api/ingestion-api";
import type { MercadoLibreConfigPatch } from "./api/types";
import {
  getSavedApiBaseUrlOverride,
  normalizeApiBaseUrl,
  resolveEffectiveApiBaseUrl,
  saveApiBaseUrlOverride,
} from "./api/url-config";

export * from "./api/types";
export {
  AdminIntegrationsApi,
  ApiClientError,
  AuthSystemApi,
  BaseHttpClient,
  CatalogInventoryApi,
  DispatchApi,
  FilesIngestionApi,
  getSavedApiBaseUrlOverride,
  normalizeApiBaseUrl,
  resolveEffectiveApiBaseUrl,
  saveApiBaseUrlOverride,
  type ApiClientOptions,
};

/**
 * Cliente API fachada que mantiene 100% compatibilidad de métodos públicos
 * delegando en módulos especializados por dominio.
 */
export class StockAgentApiClient {
  private readonly http: BaseHttpClient;
  readonly auth: AuthSystemApi;
  readonly catalog: CatalogInventoryApi;
  readonly dispatch: DispatchApi;
  readonly ingestion: FilesIngestionApi;
  readonly admin: AdminIntegrationsApi;

  constructor(options: ApiClientOptions) {
    this.http = new BaseHttpClient(options);
    this.auth = new AuthSystemApi(this.http);
    this.catalog = new CatalogInventoryApi(this.http);
    this.dispatch = new DispatchApi(this.http);
    this.ingestion = new FilesIngestionApi(this.http);
    this.admin = new AdminIntegrationsApi(this.http);
  }

  setBaseUrl(nextUrl: string): void {
    this.http.setBaseUrl(nextUrl);
  }

  getBaseUrl(): string {
    return this.http.getBaseUrl();
  }

  // Sistema & Auth
  ping = () => this.auth.ping();
  getSystemStatus = () => this.auth.getSystemStatus();
  login = (payload: LoginRequest) => this.auth.login(payload);
  getMe = () => this.auth.getMe();
  logout = () => this.auth.logout();
  changePassword = (current_password: string, new_password: string) =>
    this.auth.changePassword(current_password, new_password);
  listUsers = () => this.auth.listUsers();
  createUser = (payload: CreateUserRequest) => this.auth.createUser(payload);
  updateUser = (id: number, payload: UpdateUserRequest) =>
    this.auth.updateUser(id, payload);
  listApiKeys = () => this.auth.listApiKeys();
  createApiKey = (payload: CreateApiKeyRequest) =>
    this.auth.createApiKey(payload);
  revokeApiKey = (keyHash: string) => this.auth.revokeApiKey(keyHash);

  // Productos, Reposición & Inventario Físico
  searchProducts = (q = "", limit = 100) => this.catalog.searchProducts(q, limit);
  getProduct = (codeOrBarcode: string) => this.catalog.getProduct(codeOrBarcode);
  upsertProduct = (payload: UpsertProductRequest) =>
    this.catalog.upsertProduct(payload);
  adjustProductStock = (
    code: string,
    payload: Parameters<CatalogInventoryApi["adjustProductStock"]>[1]
  ) => this.catalog.adjustProductStock(code, payload);
  updateProductLocation = (code: string, ubicacion: string) =>
    this.catalog.updateProductLocation(code, ubicacion);
  associateProductBarcode = (code: string, cod_barras: string) =>
    this.catalog.associateProductBarcode(code, cod_barras);
  getReplenishmentAnalysis = (soloCriticos = false) =>
    this.catalog.getReplenishmentAnalysis(soloCriticos);
  getMovementsHistory = (limit = 100) => this.catalog.getMovementsHistory(limit);
  comparePreliminaryInventory = (
    conteo: Record<string, number>,
    nombreArchivo?: string
  ) => this.catalog.comparePreliminaryInventory(conteo, nombreArchivo);
  finalizePhysicalInventory = (
    conteo: Record<string, number>,
    nombreArchivo?: string
  ) => this.catalog.finalizePhysicalInventory(conteo, nombreArchivo);

  // Despacho QR
  listDispatchOrders = (estadoDespacho = "", limit = 100) =>
    this.dispatch.listDispatchOrders(estadoDespacho, limit);
  getDispatchOrder = (notaPedido: string) =>
    this.dispatch.getDispatchOrder(notaPedido);
  scanDispatch = (codigo: string, nuevo_estado?: DispatchStatusTarget) =>
    this.dispatch.scanDispatch(codigo, nuevo_estado);
  scanDispatchBatch = (
    items: Array<{ codigo: string; nuevo_estado?: DispatchStatusTarget }>
  ) => this.dispatch.scanDispatchBatch(items);
  acquireOrderLock = (orderId: number) => this.dispatch.acquireOrderLock(orderId);
  releaseOrderLock = (orderId: number) => this.dispatch.releaseOrderLock(orderId);

  // Archivos & Ingesta
  listStoredFiles = (category = "", limit = 50) =>
    this.ingestion.listStoredFiles(category, limit);
  deleteStoredFile = (id: string) => this.ingestion.deleteStoredFile(id);
  downloadStoredFile = (id: string) => this.ingestion.downloadStoredFile(id);
  uploadAndSimulate = (params: {
    category: FileUploadCategory;
    files: File[];
    operation?: IngestionOperation;
    failOnUnmatched?: boolean;
  }) => this.ingestion.uploadAndSimulate(params);
  confirmIngestion = (
    payload: Parameters<FilesIngestionApi["confirmIngestion"]>[0],
    idempotencyKey?: string
  ) => this.ingestion.confirmIngestion(payload, idempotencyKey);

  // Chat, Notificaciones, Auditoría, Mercado Libre & SaaS
  listChatMessages = (limit = 60) => this.admin.listChatMessages(limit);
  sendChatMessage = (mensaje: string, destinatario = "Todos") =>
    this.admin.sendChatMessage(mensaje, destinatario);
  markChatRead = () => this.admin.markChatRead();
  listNotifications = (soloNoLeidas = false, limit = 40) =>
    this.admin.listNotifications(soloNoLeidas, limit);
  markNotificationsRead = (id?: number) => this.admin.markNotificationsRead(id);
  listAuditLogs = (limit = 80) => this.admin.listAuditLogs(limit);
  getMercadoLibreConfig = () => this.admin.getMercadoLibreConfig();
  updateMercadoLibreConfig = (patch: MercadoLibreConfigPatch) =>
    this.admin.updateMercadoLibreConfig(patch);
  getMercadoLibreOAuthUrl = (redirectUri: string, state = "") =>
    this.admin.getMercadoLibreOAuthUrl(redirectUri, state);
  submitMercadoLibreOAuthCallback = (code: string, redirectUri: string) =>
    this.admin.submitMercadoLibreOAuthCallback(code, redirectUri);
  verifyMercadoLibre = () => this.admin.verifyMercadoLibre();
  syncMercadoLibreOrders = (simulateOnly = true) =>
    this.admin.syncMercadoLibreOrders(simulateOnly);
  getSaasUsage = () => this.admin.getSaasUsage();
  exportTenantBackup = () => this.admin.exportTenantBackup();
}

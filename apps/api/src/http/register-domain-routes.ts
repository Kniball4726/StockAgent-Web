import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import type { Database } from "../db/client.js";
import {
  AuditChatRepository,
  OrderRepository,
  ProductRepository,
  TenantAuthRepository,
  TenantSettingsRepository,
} from "../db/index.js";
import { MercadoLibreService } from "../integrations/mercado-libre-service.js";
import type {
  EventBusAdapter,
  QueueAdapter,
  WebSocketHub,
} from "../realtime/index.js";
import type { TenantBackupService } from "../saas/backup-service.js";
import type { TenantAdminService } from "../saas/tenant-admin-service.js";
import { FileUploadService } from "../services/file-service.js";
import { IngestionService } from "../services/ingestion-service.js";
import { createStorageAdapter, type StorageAdapter } from "../storage/index.js";
import { createDbAuthResolver, type AuthResolver } from "./auth-context.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerDispatchRoutes } from "./dispatch-routes.js";
import { registerFilesRoutes } from "./files-routes.js";
import { registerIngestionRoutes } from "./ingestion-routes.js";
import { registerInventoryRoutes } from "./inventory-routes.js";
import { registerMercadoLibreRoutes } from "./mercadolibre-routes.js";
import { registerParsersRoutes } from "./parsers-routes.js";
import { registerProductsRoutes } from "./products-routes.js";
import { registerSaasRoutes } from "./saas-routes.js";
import { registerSystemAndChatRoutes } from "./system-chat-routes.js";

export interface DomainRoutesOptions {
  db?: Database | undefined;
  config: AppConfig;
  storage?: StorageAdapter | undefined;
  authResolver?: AuthResolver | undefined;
  fileService?: FileUploadService | undefined;
  ingestionService?: IngestionService | undefined;
  authRepo?: TenantAuthRepository | undefined;
  productRepo?: ProductRepository | undefined;
  orderRepo?: OrderRepository | undefined;
  auditRepo?: AuditChatRepository | undefined;
  settingsRepo?: TenantSettingsRepository | undefined;
  mercadoLibreService?: MercadoLibreService | undefined;
  tenantAdminService?: TenantAdminService | undefined;
  backupService?: TenantBackupService | undefined;
  eventBus: EventBusAdapter;
  queue: QueueAdapter;
  wsHub: WebSocketHub;
}

export function registerDomainRoutes(
  app: FastifyInstance,
  options: DomainRoutesOptions
): void {
  const { config, eventBus, queue, wsHub } = options;

  if (!options.db) {
    registerSystemAndChatRoutes(app, {
      config,
      eventBus,
      queue,
      wsHub,
    });
    return;
  }

  const db = options.db;
  const storage = options.storage ?? createStorageAdapter(config);
  const authResolver = options.authResolver ?? createDbAuthResolver(db);
  const authRepo = options.authRepo ?? new TenantAuthRepository(db);
  const auditRepo = options.auditRepo ?? new AuditChatRepository();
  const orderRepo = options.orderRepo ?? new OrderRepository();
  const productRepo = options.productRepo ?? new ProductRepository();
  const settingsRepo = options.settingsRepo ?? new TenantSettingsRepository();

  const fileService =
    options.fileService ??
    new FileUploadService(
      storage,
      auditRepo,
      orderRepo,
      config.storageMaxFileBytes
    );
  const ingestionService =
    options.ingestionService ??
    new IngestionService(productRepo, orderRepo, auditRepo);
  const mercadoLibreService =
    options.mercadoLibreService ??
    new MercadoLibreService(settingsRepo, productRepo, orderRepo);

  registerSystemAndChatRoutes(app, {
    db,
    config,
    authResolver,
    authRepo,
    auditRepo,
    productRepo,
    eventBus,
    queue,
    wsHub,
  });
  registerAuthRoutes(app, {
    db,
    authResolver,
    authRepo,
    defaultTenantSlug: config.defaultTenantSlug,
  });
  registerProductsRoutes(app, {
    db,
    authResolver,
    productRepo,
    eventBus,
  });
  registerInventoryRoutes(app, {
    db,
    authResolver,
    productRepo,
    auditRepo,
    eventBus,
    queue,
  });
  registerDispatchRoutes(app, {
    db,
    authResolver,
    orderRepo,
    eventBus,
  });
  registerFilesRoutes(app, { db, authResolver, fileService });
  registerIngestionRoutes(app, {
    db,
    authResolver,
    ingestionService,
    eventBus,
  });
  registerParsersRoutes(app, {
    db,
    authResolver,
    fileService,
    ingestionService,
    productRepo,
  });
  registerMercadoLibreRoutes(app, {
    db,
    authResolver,
    settingsRepo,
    mercadoLibreService,
    ingestionService,
  });
  registerSaasRoutes(app, {
    db,
    config,
    authResolver,
    authRepo,
    tenantAdminService: options.tenantAdminService,
    backupService: options.backupService,
  });
  app.after(() => {
    wsHub.registerRoutes(app, authResolver);
  });
}

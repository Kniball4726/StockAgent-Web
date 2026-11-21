import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { loadAppConfig, type AppConfig } from "./config/env.js";
import type { Database } from "./db/client.js";
import type {
  AuditChatRepository,
  OrderRepository,
  ProductRepository,
  TenantAuthRepository,
  TenantSettingsRepository,
} from "./db/index.js";
import type { AuthResolver } from "./http/auth-context.js";
import { registerErrorHandler } from "./http/error-handler.js";
import { registerInfraRoutes } from "./http/infra-routes.js";
import { registerHttpMiddleware } from "./http/middleware.js";
import { registerDomainRoutes } from "./http/register-domain-routes.js";
import type { MercadoLibreService } from "./integrations/mercado-libre-service.js";
import {
  buildFastifyLoggerOptions,
  MetricsRegistry,
} from "./observability/metrics.js";
import {
  createEventBusAdapter,
  createQueueAdapter,
  WebSocketHub,
  type EventBusAdapter,
  type QueueAdapter,
} from "./realtime/index.js";
import type { TenantBackupService } from "./saas/backup-service.js";
import type { TenantAdminService } from "./saas/tenant-admin-service.js";
import type { FileUploadService } from "./services/file-service.js";
import type { IngestionService } from "./services/ingestion-service.js";
import type { StorageAdapter } from "./storage/index.js";

export interface CreateAppOptions {
  db?: Database | undefined;
  storage?: StorageAdapter | undefined;
  authResolver?: AuthResolver | undefined;
  config?: AppConfig | undefined;
  logger?: boolean | undefined;
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
  eventBus?: EventBusAdapter | undefined;
  queue?: QueueAdapter | undefined;
  readinessProbe?: (() => Promise<boolean>) | undefined;
}

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadAppConfig();
  const app = Fastify({
    logger: buildFastifyLoggerOptions(options.logger ?? true, config.nodeEnv),
    trustProxy: config.trustProxy,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

  const ownsEventBus = !options.eventBus;
  const ownsQueue = !options.queue;
  const eventBus = options.eventBus ?? createEventBusAdapter(config);
  const queue = options.queue ?? createQueueAdapter(config);
  const wsHub = new WebSocketHub(eventBus);
  const metrics = new MetricsRegistry();

  app.register(websocket);
  app.register(multipart, {
    limits: {
      fileSize: config.storageMaxFileBytes,
      files: 20,
    },
  });

  registerHttpMiddleware(app, {
    config,
    metrics,
    wsHub,
    eventBus,
    queue,
    ownsEventBus,
    ownsQueue,
  });
  registerErrorHandler(app);
  registerInfraRoutes(app, {
    config,
    db: options.db,
    readinessProbe: options.readinessProbe,
    metrics,
    wsHub,
    eventBus,
    queue,
  });
  registerDomainRoutes(app, {
    ...options,
    config,
    eventBus,
    queue,
    wsHub,
  });

  return app;
}

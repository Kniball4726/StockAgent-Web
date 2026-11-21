import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyError, type FastifyReply } from "fastify";
import { ZodError } from "zod";
import { HealthResponseSchema } from "@stockagent/shared";
import { loadAppConfig, type AppConfig } from "./config/env.js";
import type { Database } from "./db/client.js";
import {
  AuditChatRepository,
  DomainError,
  OrderRepository,
  ProductRepository,
  TenantAuthRepository,
  TenantSettingsRepository,
} from "./db/index.js";
import { createDbAuthResolver, type AuthResolver } from "./http/auth-context.js";
import { registerAuthRoutes } from "./http/auth-routes.js";
import { registerDispatchRoutes } from "./http/dispatch-routes.js";
import { registerFilesRoutes } from "./http/files-routes.js";
import { registerIngestionRoutes } from "./http/ingestion-routes.js";
import { registerInventoryRoutes } from "./http/inventory-routes.js";
import { registerMercadoLibreRoutes } from "./http/mercadolibre-routes.js";
import { registerParsersRoutes } from "./http/parsers-routes.js";
import { registerProductsRoutes } from "./http/products-routes.js";
import { registerSaasRoutes } from "./http/saas-routes.js";
import { registerSystemAndChatRoutes } from "./http/system-chat-routes.js";
import { MercadoLibreService } from "./integrations/mercado-libre-service.js";
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
import {
  applySecurityHeaders,
  constantTimeTokenEqual,
  GlobalRateLimiter,
} from "./security/http-hardening.js";
import { FileUploadService } from "./services/file-service.js";
import { IngestionService } from "./services/ingestion-service.js";
import { createStorageAdapter, type StorageAdapter } from "./storage/index.js";

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

function sendFormattedError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  issues?: unknown
) {
  return reply.code(statusCode).send({
    ok: false,
    detail: message,
    message,
    error: {
      code,
      message,
      ...(issues !== undefined ? { issues } : {}),
    },
  });
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
  const rateLimiter = new GlobalRateLimiter(
    config.rateLimitMax,
    config.rateLimitWindowMs
  );
  const reqStartedAt = new WeakMap<object, number>();

  app.register(websocket);
  app.register(multipart, {
    limits: {
      fileSize: config.storageMaxFileBytes,
      files: 20,
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    reqStartedAt.set(request, performance.now());
    reply.header("X-Request-Id", request.id);
    applySecurityHeaders(reply, config);

    const routePath = request.url.split("?")[0] ?? request.url;
    const isInfraProbe =
      routePath === "/health" ||
      routePath === "/api/v1/health" ||
      routePath === "/ready" ||
      routePath === "/api/v1/ready" ||
      routePath === "/metrics";

    if (!isInfraProbe && request.method !== "OPTIONS") {
      const rate = rateLimiter.consume(request);
      reply.header("X-RateLimit-Limit", String(rate.limit));
      reply.header("X-RateLimit-Remaining", String(rate.remaining));
      if (!rate.allowed) {
        reply.header("Retry-After", String(rate.retryAfterSeconds));
        return sendFormattedError(
          reply,
          429,
          "RATE_LIMIT_EXCEEDED",
          "Demasiadas solicitudes consecutivas. Reintentá en unos segundos."
        );
      }
    }

    const origin = request.headers.origin;
    if (!origin) {
      return;
    }
    const allowAll = config.corsOrigins.includes("*");
    const isAllowed = allowAll || config.corsOrigins.includes(origin);
    if (!isAllowed) {
      if (request.method === "OPTIONS") {
        return reply.code(204).send();
      }
      return;
    }

    reply.header("Access-Control-Allow-Origin", allowAll ? "*" : origin);
    reply.header("Vary", "Origin");
    reply.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    reply.header(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-Auth-Token,X-API-Key,Idempotency-Key,X-SaaS-Admin-Key"
    );
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const start = reqStartedAt.get(request);
    const durationMs =
      start !== undefined ? performance.now() - start : 0;
    const routePattern =
      request.routeOptions?.url ?? (request.url.split("?")[0] || "/");
    metrics.recordHttpRequest({
      method: request.method,
      route: routePattern,
      statusCode: reply.statusCode,
      durationMs,
    });
  });

  app.addHook("onClose", async () => {
    await wsHub.close();
    const closers: Array<Promise<void>> = [];
    if (ownsEventBus) closers.push(eventBus.close());
    if (ownsQueue) closers.push(queue.close());
    if (closers.length > 0) {
      await Promise.allSettled(closers);
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return sendFormattedError(
        reply,
        error.statusCode,
        error.code,
        error.message
      );
    }

    if (error instanceof ZodError) {
      return sendFormattedError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Los datos enviados no cumplen con el contrato esperado.",
        error.issues
      );
    }

    const fastifyErr = error as FastifyError;
    if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE") {
      return sendFormattedError(
        reply,
        413,
        "FILE_TOO_LARGE",
        "El archivo supera el tamaño máximo permitido."
      );
    }

    const status =
      typeof fastifyErr.statusCode === "number" &&
      fastifyErr.statusCode >= 400 &&
      fastifyErr.statusCode < 500
        ? fastifyErr.statusCode
        : 500;

    return sendFormattedError(
      reply,
      status,
      fastifyErr.code ?? "INTERNAL_ERROR",
      status >= 500 ? "Error interno del servidor." : fastifyErr.message
    );
  });

  const health = () =>
    HealthResponseSchema.parse({
      status: "ok",
      service: "stockagent-api",
    });

  app.get("/health", health);
  app.get("/api/v1/health", health);

  const readinessHandler = async (_request: unknown, reply: FastifyReply) => {
    let dbOk = true;
    try {
      if (options.readinessProbe) {
        dbOk = await options.readinessProbe();
      } else if (
        options.db &&
        typeof (options.db as unknown as { execute?: unknown }).execute === "function"
      ) {
        await (
          options.db as unknown as { execute: (q: unknown) => Promise<unknown> }
        ).execute(sql`SELECT 1`);
      }
    } catch {
      dbOk = false;
    }

    if (!dbOk) {
      return reply.code(503).send({
        status: "degraded",
        service: "stockagent-api",
        checks: {
          database: "down",
          queue: queue.driver,
          eventBus: eventBus.driver,
        },
      });
    }

    return {
      status: "ready",
      service: "stockagent-api",
      checks: {
        database: options.db ? "ok" : "disabled",
        queue: queue.driver,
        eventBus: eventBus.driver,
      },
    };
  };

  app.get("/ready", async (_request, reply) => readinessHandler(_request, reply));
  app.get("/api/v1/ready", async (_request, reply) => readinessHandler(_request, reply));

  app.get("/metrics", async (request, reply) => {
    if (config.metricsToken) {
      const authHeader = String(request.headers.authorization ?? "");
      const bearer = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";
      if (!constantTimeTokenEqual(bearer, config.metricsToken)) {
        return sendFormattedError(
          reply,
          401,
          "UNAUTHORIZED",
          "Token requerido para consultar métricas."
        );
      }
    }
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(
        metrics.renderPrometheusText({ wsClients: wsHub.getConnectionCount() })
      );
  });

  if (options.db) {
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
  } else {
    registerSystemAndChatRoutes(app, {
      config,
      eventBus,
      queue,
      wsHub,
    });
  }

  return app;
}

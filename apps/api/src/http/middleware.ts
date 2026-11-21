import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type {
  EventBusAdapter,
  QueueAdapter,
  WebSocketHub,
} from "../realtime/index.js";
import {
  applySecurityHeaders,
  GlobalRateLimiter,
} from "../security/http-hardening.js";
import { sendFormattedError } from "./error-handler.js";

const INFRA_PROBE_PATHS = new Set([
  "/health",
  "/api/v1/health",
  "/ready",
  "/api/v1/ready",
  "/metrics",
]);

export interface HttpMiddlewareDeps {
  config: AppConfig;
  metrics: MetricsRegistry;
  wsHub: WebSocketHub;
  eventBus: EventBusAdapter;
  queue: QueueAdapter;
  ownsEventBus: boolean;
  ownsQueue: boolean;
}

export function registerHttpMiddleware(
  app: FastifyInstance,
  deps: HttpMiddlewareDeps
): void {
  const { config, metrics, wsHub, eventBus, queue, ownsEventBus, ownsQueue } =
    deps;
  const rateLimiter = new GlobalRateLimiter(
    config.rateLimitMax,
    config.rateLimitWindowMs
  );
  const reqStartedAt = new WeakMap<object, number>();

  app.addHook("onRequest", async (request, reply) => {
    reqStartedAt.set(request, performance.now());
    reply.header("X-Request-Id", request.id);
    applySecurityHeaders(reply, config);

    const routePath = request.url.split("?")[0] ?? request.url;
    if (!INFRA_PROBE_PATHS.has(routePath) && request.method !== "OPTIONS") {
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
    const durationMs = start !== undefined ? performance.now() - start : 0;
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
}

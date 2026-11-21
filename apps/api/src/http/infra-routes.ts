import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { HealthResponseSchema } from "@stockagent/shared";
import type { AppConfig } from "../config/env.js";
import type { Database } from "../db/client.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type {
  EventBusAdapter,
  QueueAdapter,
  WebSocketHub,
} from "../realtime/index.js";
import { constantTimeTokenEqual } from "../security/http-hardening.js";
import { sendFormattedError } from "./error-handler.js";

export interface InfraRoutesDeps {
  config: AppConfig;
  db?: Database | undefined;
  readinessProbe?: (() => Promise<boolean>) | undefined;
  metrics: MetricsRegistry;
  wsHub: WebSocketHub;
  eventBus: EventBusAdapter;
  queue: QueueAdapter;
}

export function registerInfraRoutes(
  app: FastifyInstance,
  deps: InfraRoutesDeps
): void {
  const { config, db, readinessProbe, metrics, wsHub, eventBus, queue } = deps;

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
      if (readinessProbe) {
        dbOk = await readinessProbe();
      } else if (
        db &&
        typeof (db as unknown as { execute?: unknown }).execute === "function"
      ) {
        await (
          db as unknown as { execute: (q: unknown) => Promise<unknown> }
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
        database: db ? "ok" : "disabled",
        queue: queue.driver,
        eventBus: eventBus.driver,
      },
    };
  };

  app.get("/ready", async (_request, reply) => readinessHandler(_request, reply));
  app.get("/api/v1/ready", async (_request, reply) =>
    readinessHandler(_request, reply)
  );

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
}

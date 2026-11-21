import { networkInterfaces } from "node:os";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SendChatMessageRequestSchema } from "@stockagent/shared";
import type { AppConfig } from "../config/env.js";
import type { Database } from "../db/client.js";
import type { AuditChatRepository } from "../repositories/audit-chat-repository.js";
import type { ProductRepository } from "../repositories/product-repository.js";
import type { TenantAuthRepository } from "../repositories/tenant-auth-repository.js";
import {
  createDomainEvent,
  type EventBusAdapter,
  type QueueAdapter,
} from "../realtime/types.js";
import type { WebSocketHub } from "../realtime/websocket-hub.js";
import {
  assertRoles,
  authenticateRequest,
  tryAuthenticateRequest,
  type AuthResolver,
} from "./auth-context.js";

function resolveLocalIpv4(): string {
  const ifaces = networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const addr of entries) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "127.0.0.1";
}

function formatServerTime(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

const LimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const MarkNotificationBodySchema = z.object({
  notification_id: z.number().int().positive().optional(),
});

export function registerSystemAndChatRoutes(
  app: FastifyInstance,
  deps: {
    db?: Database | undefined;
    config: AppConfig;
    authResolver?: AuthResolver | undefined;
    authRepo?: TenantAuthRepository | undefined;
    auditRepo?: AuditChatRepository | undefined;
    productRepo?: ProductRepository | undefined;
    eventBus: EventBusAdapter;
    queue: QueueAdapter;
    wsHub: WebSocketHub;
  }
): void {
  app.get("/api/v1/sistema/ping", async () => {
    return {
      status: "pong",
      timestamp: Date.now() / 1000,
    };
  });

  app.get("/api/v1/sistema/estado", async (request) => {
    const auth =
      deps.authResolver && deps.db
        ? await tryAuthenticateRequest(request, deps.authResolver)
        : null;

    if (!auth || !deps.db || !deps.authRepo) {
      return {
        ok: true,
        version: "1.0.0",
        servidor_hora: "",
        ip_local: "",
        sesiones_activas: 0,
        modo_conexion: "",
      };
    }

    const sesionesActivas = await deps.authRepo.countActiveSessions({
      db: deps.db,
      tenantId: auth.tenantId,
    });

    return {
      ok: true,
      version: "1.0.0",
      servidor_hora: formatServerTime(),
      ip_local: resolveLocalIpv4(),
      sesiones_activas: sesionesActivas,
      websocket_clientes: deps.wsHub.getConnectionCount(auth.tenantId),
      modo_conexion: deps.config.publicScheme,
      queue_driver: deps.queue.driver,
      event_bus_driver: deps.eventBus.driver,
    };
  });

  if (!deps.db || !deps.authResolver || !deps.auditRepo || !deps.productRepo) {
    return;
  }

  const db = deps.db;
  const authResolver = deps.authResolver;
  const auditRepo = deps.auditRepo;
  const productRepo = deps.productRepo;

  app.get("/api/v1/chat/mensajes", async (request) => {
    const auth = await authenticateRequest(request, authResolver);
    const query = LimitQuerySchema.parse(request.query);
    const mensajes = await auditRepo.listChatMessages(
      { db, tenantId: auth.tenantId },
      auth.username,
      query.limit
    );
    return { ok: true, mensajes };
  });

  app.post("/api/v1/chat/mensajes", async (request, reply) => {
    const auth = await authenticateRequest(request, authResolver);
    const body = SendChatMessageRequestSchema.parse(request.body);
    const msg = await auditRepo.sendChatMessage(
      { db, tenantId: auth.tenantId },
      {
        emisor: auth.username,
        destinatario: body.destinatario,
        mensaje: body.mensaje,
      }
    );

    await deps.eventBus.publish(
      createDomainEvent({
        tenantId: auth.tenantId,
        type: "CHAT_MESSAGE",
        actor: auth.username,
        payload: {
          id: msg.id,
          emisor: msg.emisor,
          destinatario: msg.destinatario,
          mensaje: msg.mensaje,
          created_at: msg.createdAt.toISOString(),
        },
      })
    );

    return reply.code(201).send({ ok: true, mensaje: msg });
  });

  app.post("/api/v1/chat/marcar-leidos", async (request) => {
    const auth = await authenticateRequest(request, authResolver);
    await auditRepo.markChatMessagesRead(
      { db, tenantId: auth.tenantId },
      auth.username
    );
    return { ok: true };
  });

  app.get("/api/v1/notificaciones", async (request) => {
    const auth = await authenticateRequest(request, authResolver);
    assertRoles(auth, ["administrador", "operador"]);
    const rawQ = (request.query ?? {}) as Record<string, unknown>;
    const unreadOnly = rawQ.solo_no_leidas === "true";
    const { limit } = LimitQuerySchema.parse(rawQ);
    const notificaciones = await productRepo.listAdminNotifications(
      { db, tenantId: auth.tenantId },
      unreadOnly,
      limit
    );
    return { ok: true, notificaciones };
  });

  app.post("/api/v1/notificaciones/leer", async (request) => {
    const auth = await authenticateRequest(request, authResolver);
    assertRoles(auth, ["administrador"]);
    const body = MarkNotificationBodySchema.parse(request.body ?? {});
    await productRepo.markNotificationsRead(
      { db, tenantId: auth.tenantId },
      body.notification_id
    );
    return { ok: true };
  });

  app.get("/api/v1/auditoria", async (request) => {
    const auth = await authenticateRequest(request, authResolver);
    assertRoles(auth, ["administrador"]);
    const { limit } = LimitQuerySchema.parse(request.query);
    const logs = await auditRepo.listAuditLogs(
      { db, tenantId: auth.tenantId },
      limit
    );
    return { ok: true, logs };
  });
}

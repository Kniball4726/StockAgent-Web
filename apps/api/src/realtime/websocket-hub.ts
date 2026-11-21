import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { AuthContext, AuthResolver } from "../http/auth-context.js";
import type { DomainEvent, EventBusAdapter } from "./types.js";

interface ConnectedClient {
  socket: WebSocket;
  auth: AuthContext;
  connectedAt: string;
}

export class WebSocketHub {
  private readonly clientsByTenant = new Map<string, Set<ConnectedClient>>();
  private unsubscribeBus: (() => void) | null = null;

  constructor(private readonly eventBus: EventBusAdapter) {
    this.unsubscribeBus = this.eventBus.subscribe((event) => {
      this.broadcastToTenant(event);
    });
  }

  broadcastToTenant(event: DomainEvent): void {
    const room = this.clientsByTenant.get(event.tenantId);
    if (!room || room.size === 0) {
      return;
    }

    const payload = JSON.stringify({
      event: "domain_event",
      ...event,
    });

    for (const client of Array.from(room)) {
      if (client.socket.readyState === 1) {
        try {
          client.socket.send(payload);
        } catch {
          room.delete(client);
        }
      } else if (client.socket.readyState > 1) {
        room.delete(client);
      }
    }
  }

  getConnectionCount(tenantId?: string): number {
    if (tenantId) {
      return this.clientsByTenant.get(tenantId)?.size ?? 0;
    }
    let total = 0;
    for (const room of this.clientsByTenant.values()) {
      total += room.size;
    }
    return total;
  }

  registerRoutes(
    app: FastifyInstance,
    authResolver: AuthResolver
  ): void {
    app.get("/api/v1/ws", { websocket: true }, async (socket, request) => {
      let effectiveRequest = request;

      const query = request.query as Record<string, unknown> | undefined;
      const queryToken =
        typeof query?.token === "string" ? query.token.trim() : "";

      if (
        queryToken &&
        !request.headers.authorization &&
        !request.headers["x-auth-token"] &&
        !request.headers["x-api-key"]
      ) {
        effectiveRequest = Object.create(request, {
          headers: {
            value: {
              ...request.headers,
              authorization: `Bearer ${queryToken}`,
            },
            enumerable: true,
          },
        }) as FastifyRequest;
      }

      const auth = await authResolver(effectiveRequest).catch(() => null);
      if (!auth) {
        socket.close(1008, "Autenticación requerida.");
        return;
      }

      const client: ConnectedClient = {
        socket,
        auth,
        connectedAt: new Date().toISOString(),
      };

      let room = this.clientsByTenant.get(auth.tenantId);
      if (!room) {
        room = new Set<ConnectedClient>();
        this.clientsByTenant.set(auth.tenantId, room);
      }
      room.add(client);

      socket.send(
        JSON.stringify({
          event: "connected",
          tenant_id: auth.tenantId,
          username: auth.username,
          role: auth.role,
          connected_at: client.connectedAt,
        })
      );

      socket.on("message", (raw: Buffer | string) => {
        const text = raw.toString("utf8").trim();
        if (!text) {
          return;
        }
        try {
          const parsed = JSON.parse(text) as { type?: string };
          if (parsed.type === "ping") {
            socket.send(
              JSON.stringify({
                event: "pong",
                timestamp: Date.now(),
              })
            );
          }
        } catch {
          if (text.toLowerCase() === "ping") {
            socket.send(JSON.stringify({ event: "pong", timestamp: Date.now() }));
          }
        }
      });

      socket.on("close", () => {
        const currentRoom = this.clientsByTenant.get(auth.tenantId);
        if (currentRoom) {
          currentRoom.delete(client);
          if (currentRoom.size === 0) {
            this.clientsByTenant.delete(auth.tenantId);
          }
        }
      });
    });
  }

  async close(): Promise<void> {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    for (const room of this.clientsByTenant.values()) {
      for (const client of room) {
        if (client.socket.readyState <= 1) {
          client.socket.close(1001, "Servidor apagándose.");
        }
      }
      room.clear();
    }
    this.clientsByTenant.clear();
  }
}

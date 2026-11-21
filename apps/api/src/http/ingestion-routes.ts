import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ConfirmIngestionRequestSchema,
  IngestionDocumentInputSchema,
  SimulateIngestionRequestSchema,
} from "@stockagent/shared";
import type { Database } from "../db/client.js";
import {
  createDomainEvent,
  type EventBusAdapter,
} from "../realtime/types.js";
import type { IngestionService } from "../services/ingestion-service.js";
import {
  assertRoles,
  authenticateRequest,
  type AuthResolver,
} from "./auth-context.js";

const ConsolidateBodySchema = z.object({
  documents: z.array(IngestionDocumentInputSchema).min(1),
  allowZero: z.boolean().default(false),
});

export function registerIngestionRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    authResolver: AuthResolver;
    ingestionService: IngestionService;
    eventBus?: EventBusAdapter | undefined;
  }
): void {
  app.post("/api/v1/ingestion/consolidate", async (request) => {
    await authenticateRequest(request, deps.authResolver);
    const body = ConsolidateBodySchema.parse(request.body);
    const consolidated = deps.ingestionService.consolidate(
      body.documents,
      body.allowZero
    );
    return { ok: true, ...consolidated };
  });

  app.post("/api/v1/ingestion/simulate", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador", "operador", "picker"]);

    const body = SimulateIngestionRequestSchema.parse(request.body);
    const simulation = await deps.ingestionService.simulate(
      { db: deps.db, tenantId: auth.tenantId },
      body
    );
    return { ok: true, simulation };
  });

  app.post("/api/v1/ingestion/confirm", async (request, reply) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador", "operador", "picker"]);

    const parsedBody = ConfirmIngestionRequestSchema.parse(request.body);
    if (parsedBody.operation === "ingreso_fabrica") {
      assertRoles(auth, ["administrador", "operador"]);
    }

    const headerTxId =
      typeof request.headers["idempotency-key"] === "string"
        ? request.headers["idempotency-key"].trim()
        : undefined;

    const result = await deps.ingestionService.confirm(
      { db: deps.db, tenantId: auth.tenantId },
      {
        ...parsedBody,
        txId: parsedBody.txId ?? (headerTxId || undefined),
        usuario: parsedBody.usuario ?? auth.username,
      }
    );

    if (deps.eventBus) {
      await deps.eventBus.publish(
        createDomainEvent({
          tenantId: auth.tenantId,
          type: "INGESTION_CONFIRMED",
          actor: auth.username,
          payload: {
            operation: result.operation,
            order_ids: result.orderIds,
            dispatch_id: result.dispatchId,
            total_unidades: result.totalUnidadesAplicadas,
          },
        })
      );
    }

    return reply.code(201).send({ ok: true, result });
  });
}

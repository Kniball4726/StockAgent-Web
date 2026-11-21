import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { MercadoLibreService } from "../integrations/mercado-libre-service.js";
import { TenantSettingsRepository } from "../repositories/tenant-settings-repository.js";
import type { IngestionService } from "../services/ingestion-service.js";
import {
  assertRoles,
  authenticateRequest,
  type AuthResolver,
} from "./auth-context.js";

const UpdateMlConfigSchema = z.object({
  appId: z.string().optional(),
  clientSecret: z.string().optional(),
  sellerId: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  activo: z.boolean().optional(),
  filtroEstado: z.string().optional(),
  horasAtras: z.number().int().min(1).max(720).optional(),
  autoDescontar: z.boolean().optional(),
});

const OAuthUrlQuerySchema = z.object({
  redirectUri: z.string().url(),
  state: z.string().optional(),
});

const OAuthCallbackBodySchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
});

const SyncOrdersBodySchema = z.object({
  horas: z.number().int().min(1).max(720).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  simulateOnly: z.boolean().default(true),
  txId: z.string().min(1).max(128).optional(),
});

export function registerMercadoLibreRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    authResolver: AuthResolver;
    settingsRepo: TenantSettingsRepository;
    mercadoLibreService: MercadoLibreService;
    ingestionService: IngestionService;
  }
): void {
  app.get("/api/v1/integrations/mercadolibre/config", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador"]);

    const cfg = await deps.settingsRepo.getMercadoLibreConfig({
      db: deps.db,
      tenantId: auth.tenantId,
    });
    return {
      ok: true,
      config: TenantSettingsRepository.toMaskedConfig(cfg),
    };
  });

  app.put("/api/v1/integrations/mercadolibre/config", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador"]);

    const patch = UpdateMlConfigSchema.parse(request.body);
    const saved = await deps.settingsRepo.saveMercadoLibreConfig(
      { db: deps.db, tenantId: auth.tenantId },
      patch
    );
    return {
      ok: true,
      config: TenantSettingsRepository.toMaskedConfig(saved),
    };
  });

  app.get("/api/v1/integrations/mercadolibre/oauth-url", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador"]);

    const query = OAuthUrlQuerySchema.parse(request.query);
    const cfg = await deps.settingsRepo.getMercadoLibreConfig({
      db: deps.db,
      tenantId: auth.tenantId,
    });
    const url = deps.mercadoLibreService.buildOAuthAuthorizeUrl({
      appId: cfg.appId,
      redirectUri: query.redirectUri,
      state: query.state,
    });
    return { ok: true, url };
  });

  app.post(
    "/api/v1/integrations/mercadolibre/oauth-callback",
    async (request) => {
      const auth = await authenticateRequest(request, deps.authResolver);
      assertRoles(auth, ["administrador"]);

      const body = OAuthCallbackBodySchema.parse(request.body);
      const result = await deps.mercadoLibreService.exchangeOAuthCode(
        { db: deps.db, tenantId: auth.tenantId },
        body
      );
      return { ok: true, ...result };
    }
  );

  app.post("/api/v1/integrations/mercadolibre/verify", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador"]);

    const result = await deps.mercadoLibreService.verifyCredentials({
      db: deps.db,
      tenantId: auth.tenantId,
    });
    return result;
  });

  app.post("/api/v1/integrations/mercadolibre/orders/sync", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador", "operador"]);

    const body = SyncOrdersBodySchema.parse(request.body ?? {});
    const result = await deps.mercadoLibreService.syncOrdersWithIngestion(
      { db: deps.db, tenantId: auth.tenantId },
      deps.ingestionService,
      {
        horas: body.horas,
        limit: body.limit,
        simulateOnly: body.simulateOnly,
        usuario: auth.username,
        txId: body.txId,
      }
    );
    return { ok: true, ...result };
  });
}

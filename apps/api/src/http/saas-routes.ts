import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ProvisionTenantRequestSchema,
  UpdateTenantRequestSchema,
  VerifyBackupRequestSchema,
} from "@stockagent/shared";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import type { Database } from "../db/client.js";
import { assertRoles, authenticateRequest, type AuthResolver } from "./auth-context.js";
import { ForbiddenError } from "../repositories/base.js";
import type { TenantAuthRepository } from "../repositories/tenant-auth-repository.js";
import {
  TenantBackupService,
  verifyTenantSnapshotIntegrity,
} from "../saas/backup-service.js";
import { TenantAdminService } from "../saas/tenant-admin-service.js";
import { constantTimeTokenEqual } from "../security/http-hardening.js";

const TenantIdParamSchema = z.object({
  id: z.string().uuid(),
});

async function authorizePlatformAdmin(
  request: FastifyRequest,
  config: AppConfig,
  authResolver: AuthResolver,
  authRepo?: TenantAuthRepository
): Promise<{ actor: string }> {
  const headerKey = String(request.headers["x-saas-admin-key"] ?? "").trim();
  if (
    config.saasAdminKey &&
    headerKey &&
    constantTimeTokenEqual(headerKey, config.saasAdminKey)
  ) {
    return { actor: "saas-platform-key" };
  }

  const auth = await authenticateRequest(request, authResolver);
  assertRoles(auth, ["master"]);

  if (authRepo) {
    const rootTenant = await authRepo.getTenantBySlug(config.defaultTenantSlug);
    if (!rootTenant || auth.tenantId !== rootTenant.id) {
      throw new ForbiddenError(
        "Solo el operador de plataforma del tenant principal o X-SaaS-Admin-Key puede administrar tenants globales."
      );
    }
  } else if (config.saasAdminKey) {
    throw new ForbiddenError(
      "Se requiere X-SaaS-Admin-Key válido para gestionar tenants globales."
    );
  }

  return { actor: auth.username };
}

export interface RegisterSaasRoutesDeps {
  db: Database;
  config: AppConfig;
  authResolver: AuthResolver;
  authRepo?: TenantAuthRepository | undefined;
  tenantAdminService?: TenantAdminService | undefined;
  backupService?: TenantBackupService | undefined;
}

export function registerSaasRoutes(
  app: FastifyInstance,
  deps: RegisterSaasRoutesDeps
): void {
  const tenantAdmin = deps.tenantAdminService ?? new TenantAdminService(deps.db);
  const backupService = deps.backupService ?? new TenantBackupService(deps.db);

  // Uso y cuotas del propio tenant autenticado
  app.get("/api/v1/saas/usage", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador"]);
    const summary = await tenantAdmin.getTenantUsage(auth.tenantId);
    return { ok: true, ...summary };
  });

  // Backups lógicos firmados SHA-256 por tenant (solo Master del propio tenant)
  app.post("/api/v1/saas/backup/export", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["master"]);
    const snapshot = await backupService.exportTenantSnapshot(auth.tenantId);
    return { ok: true, snapshot };
  });

  app.post("/api/v1/saas/backup/verify", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["master"]);
    const body = VerifyBackupRequestSchema.parse(request.body ?? {});
    const check = verifyTenantSnapshotIntegrity(body.snapshot);
    if (check.snapshot && check.snapshot.tenantId !== auth.tenantId) {
      throw new ForbiddenError(
        "El backup pertenece a otro tenant y no puede verificarse en este ámbito."
      );
    }
    return {
      ok: check.valid,
      valid: check.valid,
      ...(check.reason ? { reason: check.reason } : {}),
      ...(check.snapshot
        ? {
            counts: check.snapshot.counts,
            exportedAt: check.snapshot.exportedAt,
            sha256Checksum: check.snapshot.sha256Checksum,
          }
        : {}),
    };
  });

  // Administración global de Tenants SaaS (X-SaaS-Admin-Key o Master del tenant raíz)
  app.get("/api/v1/saas/tenants", async (request) => {
    await authorizePlatformAdmin(
      request,
      deps.config,
      deps.authResolver,
      deps.authRepo
    );
    const items = await tenantAdmin.listTenants();
    return { ok: true, tenants: items };
  });

  app.post("/api/v1/saas/tenants", async (request, reply) => {
    await authorizePlatformAdmin(
      request,
      deps.config,
      deps.authResolver,
      deps.authRepo
    );
    const body = ProvisionTenantRequestSchema.parse(request.body ?? {});
    const provisioned = await tenantAdmin.provisionTenant(body);
    return reply.code(201).send({ ok: true, ...provisioned });
  });

  app.patch("/api/v1/saas/tenants/:id", async (request) => {
    await authorizePlatformAdmin(
      request,
      deps.config,
      deps.authResolver,
      deps.authRepo
    );
    const { id } = TenantIdParamSchema.parse(request.params);
    const body = UpdateTenantRequestSchema.parse(request.body ?? {});
    const updated = await tenantAdmin.updateTenant(id, body);
    return { ok: true, tenant: updated };
  });
}

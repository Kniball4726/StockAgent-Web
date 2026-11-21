import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ChangePasswordRequestSchema,
  CreateApiKeyRequestSchema,
  CreateUserRequestSchema,
  LoginRequestSchema,
  UpdateUserRequestSchema,
} from "@stockagent/shared";
import type { Database } from "../db/client.js";
import { DomainError } from "../repositories/base.js";
import { TenantAuthRepository } from "../repositories/tenant-auth-repository.js";
import {
  assertRoles,
  authenticateRequest,
  extractBearerOrAuthToken,
  type AuthResolver,
} from "./auth-context.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_LOGIN_ATTEMPTS_PER_IP = 10;

const UserIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const KeyHashParamsSchema = z.object({
  keyHash: z.string().trim().min(16),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    authResolver: AuthResolver;
    authRepo: TenantAuthRepository;
    defaultTenantSlug: string;
  }
): void {
  const ipAttempts = new Map<string, number[]>();

  function checkIpRateLimit(ip: string): void {
    const now = Date.now();
    const recent = (ipAttempts.get(ip) ?? []).filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS
    );
    if (recent.length >= MAX_LOGIN_ATTEMPTS_PER_IP) {
      throw new DomainError(
        "RATE_LIMITED",
        "Demasiados intentos de inicio de sesión desde esta dirección IP. Por favor espere 1 minuto.",
        429
      );
    }
    recent.push(now);
    ipAttempts.set(ip, recent);
  }

  app.post("/api/v1/auth/login", async (request) => {
    const clientIp = request.ip || "unknown";
    checkIpRateLimit(clientIp);

    const body = LoginRequestSchema.parse(request.body);
    const headerSlug =
      typeof request.headers["x-tenant-slug"] === "string"
        ? request.headers["x-tenant-slug"].trim()
        : undefined;
    const tenantSlug = (
      body.tenantSlug ||
      headerSlug ||
      deps.defaultTenantSlug
    )
      .trim()
      .toLowerCase();

    const tenant = await deps.authRepo.getTenantBySlug(tenantSlug);
    if (!tenant || !tenant.active) {
      throw new DomainError(
        "AUTH_INVALID",
        "Nombre de usuario o contraseña incorrectos.",
        401
      );
    }

    const scope = { db: deps.db, tenantId: tenant.id };
    const res = await deps.authRepo.authenticateDetailed(
      scope,
      body.username,
      body.password
    );

    if (res.status === "locked") {
      const minutos = Math.max(1, Math.ceil((res.retryAfterSeconds || 60) / 60));
      throw new DomainError(
        "AUTH_ACCOUNT_LOCKED",
        `Usuario bloqueado temporalmente por intentos fallidos. Intente nuevamente en ${minutos} minuto(s).`,
        423
      );
    }

    if (res.status === "inactive") {
      throw new DomainError(
        "AUTH_USER_INACTIVE",
        "La cuenta de usuario se encuentra deshabilitada.",
        403
      );
    }

    if (res.status !== "ok" || !res.user) {
      throw new DomainError(
        "AUTH_INVALID",
        "Nombre de usuario o contraseña incorrectos.",
        401
      );
    }

    const token = await deps.authRepo.createSession(scope, res.user);
    const displayName = res.user.nombre || res.user.username;

    return {
      ok: true,
      token,
      user: {
        id: res.user.id,
        username: res.user.username,
        role: res.user.role,
        nombre: displayName,
        email: res.user.email,
        tenant_id: tenant.id,
        must_change_password: res.user.mustChangePassword,
      },
      message: `¡Bienvenido ${displayName}!`,
    };
  });

  app.get("/api/v1/auth/me", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    return {
      id: auth.userId,
      username: auth.username,
      role: auth.role,
      nombre: auth.nombre || auth.username,
      email: auth.email ?? "",
      tenant_id: auth.tenantId,
    };
  });

  app.post("/api/v1/auth/logout", async (request) => {
    await authenticateRequest(request, deps.authResolver);
    const rawToken = extractBearerOrAuthToken(request);
    if (rawToken) {
      await deps.authRepo.revokeSessionByToken(rawToken);
    }
    return { ok: true, message: "Sesión cerrada correctamente." };
  });

  app.post("/api/v1/auth/change-password", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    if (auth.authType === "api_key" || auth.userId <= 0) {
      throw new DomainError(
        "UNSUPPORTED_FOR_API_KEY",
        "Las API keys no tienen contraseña interactiva.",
        400
      );
    }
    const body = ChangePasswordRequestSchema.parse(request.body);
    try {
      await deps.authRepo.changeUserPassword(
        { db: deps.db, tenantId: auth.tenantId },
        auth.userId,
        body.current_password,
        body.new_password
      );
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(
        "INVALID_PASSWORD",
        error instanceof Error ? error.message : "Contraseña inválida.",
        400
      );
    }
    return { ok: true, message: "Contraseña actualizada correctamente." };
  });

  app.get("/api/v1/auth/users", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador"]);
    const users = await deps.authRepo.listUsers(
      { db: deps.db, tenantId: auth.tenantId },
      auth.role === "master"
    );
    return { ok: true, users };
  });

  app.post("/api/v1/auth/users", async (request, reply) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador"]);
    const body = CreateUserRequestSchema.parse(request.body);

    try {
      const created = await deps.authRepo.createUser(
        { db: deps.db, tenantId: auth.tenantId },
        {
          username: body.username,
          password: body.password,
          role: body.role,
          creatorRole: auth.role,
          nombre: body.nombre,
          email: body.email,
          mustChangePassword: body.must_change_password,
        }
      );
      return reply.code(201).send({ ok: true, user: created });
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(
        "INVALID_USER_INPUT",
        error instanceof Error ? error.message : "Error creando usuario.",
        400
      );
    }
  });

  app.patch("/api/v1/auth/users/:id", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador"]);
    const { id } = UserIdParamsSchema.parse(request.params);
    const body = UpdateUserRequestSchema.parse(request.body);

    const updated = await deps.authRepo.updateUser(
      { db: deps.db, tenantId: auth.tenantId },
      id,
      {
        role: body.role,
        active: body.active,
        nombre: body.nombre,
        email: body.email,
      },
      auth.role
    );
    return { ok: true, user: updated };
  });

  app.post("/api/v1/auth/api-keys", async (request, reply) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    if (auth.role !== "master") {
      assertRoles(auth, []);
    }

    const q = (request.query ?? {}) as Record<string, unknown>;
    const b =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const parsed = CreateApiKeyRequestSchema.parse({
      client_name: b.client_name ?? q.client_name,
      role: b.role ?? q.role ?? "operador",
    });

    const { rawKey, keyHash } = await deps.authRepo.createTenantApiKey(
      { db: deps.db, tenantId: auth.tenantId },
      parsed.client_name,
      parsed.role
    );

    return reply.code(201).send({
      ok: true,
      client_name: parsed.client_name,
      role: parsed.role,
      api_key: rawKey,
      key_hash: keyHash,
      message:
        "Guarde esta clave API en un lugar seguro. No se volverá a mostrar completa.",
    });
  });

  app.get("/api/v1/auth/api-keys", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    if (auth.role !== "master") {
      assertRoles(auth, []);
    }
    const apiKeys = await deps.authRepo.listApiKeys({
      db: deps.db,
      tenantId: auth.tenantId,
    });
    return { ok: true, api_keys: apiKeys };
  });

  app.delete("/api/v1/auth/api-keys/:keyHash", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    if (auth.role !== "master") {
      assertRoles(auth, []);
    }
    const { keyHash } = KeyHashParamsSchema.parse(request.params);
    await deps.authRepo.revokeApiKey(
      { db: deps.db, tenantId: auth.tenantId },
      keyHash
    );
    return { ok: true, message: "Clave API revocada exitosamente." };
  });
}

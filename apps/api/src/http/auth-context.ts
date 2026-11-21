import type { FastifyRequest } from "fastify";
import type { UserRole } from "@stockagent/shared";
import type { Database } from "../db/client.js";
import {
  AuthenticationError,
  ForbiddenError,
} from "../repositories/base.js";
import { TenantAuthRepository } from "../repositories/tenant-auth-repository.js";

export interface AuthContext {
  tenantId: string;
  userId: number;
  username: string;
  role: UserRole;
  authType: "session" | "api_key";
  nombre?: string | undefined;
  email?: string | undefined;
}

export type AuthResolver = (
  request: FastifyRequest
) => Promise<AuthContext | null>;

function readHeader(
  request: FastifyRequest,
  name: string
): string | undefined {
  const value = request.headers[name];
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0]?.trim();
  }
  return undefined;
}

export function createDbAuthResolver(db: Database): AuthResolver {
  const authRepo = new TenantAuthRepository(db);

  return async (request: FastifyRequest): Promise<AuthContext | null> => {
    const apiKey = readHeader(request, "x-api-key");
    if (apiKey) {
      const keyRow = await authRepo.validateApiKey(apiKey);
      if (!keyRow) {
        return null;
      }
      const tenant = await authRepo.getTenantById(keyRow.tenantId);
      if (!tenant || !tenant.active) {
        return null;
      }
      return {
        tenantId: tenant.id,
        userId: 0,
        username: `api:${keyRow.clientName}`,
        role: keyRow.role,
        authType: "api_key",
        nombre: `API (${keyRow.clientName})`,
        email: "",
      };
    }

    const authHeader = readHeader(request, "authorization");
    let rawToken: string | undefined;
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      rawToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    } else {
      rawToken = readHeader(request, "x-auth-token");
    }

    if (!rawToken) {
      return null;
    }

    const session = await authRepo.resolveSessionByToken(rawToken);
    if (!session) {
      return null;
    }

    const tenant = await authRepo.getTenantById(session.tenantId);
    if (!tenant || !tenant.active) {
      return null;
    }

    return {
      tenantId: tenant.id,
      userId: session.userId,
      username: session.username,
      role: session.role,
      authType: "session",
      nombre: session.nombre,
      email: session.email,
    };
  };
}

export function extractBearerOrAuthToken(
  request: FastifyRequest
): string | undefined {
  const authHeader = readHeader(request, "authorization");
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  return readHeader(request, "x-auth-token");
}

export async function tryAuthenticateRequest(
  request: FastifyRequest,
  resolver: AuthResolver
): Promise<AuthContext | null> {
  return resolver(request).catch(() => null);
}

export async function authenticateRequest(
  request: FastifyRequest,
  resolver: AuthResolver
): Promise<AuthContext> {
  const auth = await resolver(request);
  if (!auth) {
    throw new AuthenticationError(
      "Se requiere autenticación válida (Bearer token, X-Auth-Token o X-API-Key)."
    );
  }
  return auth;
}

export function assertRoles(
  auth: AuthContext,
  allowedRoles: readonly UserRole[]
): void {
  if (auth.role === "master") {
    return;
  }
  if (!allowedRoles.includes(auth.role)) {
    throw new ForbiddenError(
      `Permisos insuficientes para el rol '${auth.role}'.`
    );
  }
}

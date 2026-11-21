import type { TenantPlan, UserRole } from "@stockagent/shared";
import type { Database } from "../db/client.js";
import type { TenantScope } from "./base.js";
import { ApiKeyRepository } from "./auth/api-key-repository.js";
import { SessionRepository } from "./auth/session-repository.js";
import { TenantRepository } from "./auth/tenant-repository.js";
import {
  toSafeUser,
  UserAuthRepository,
  type AuthDetailedResult,
  type SafeUserRecord,
  type UserRecord,
} from "./auth/user-repository.js";

export {
  ApiKeyRepository,
  SessionRepository,
  TenantRepository,
  toSafeUser,
  UserAuthRepository,
  type AuthDetailedResult,
  type SafeUserRecord,
  type UserRecord,
};

/**
 * Fachada compatible hacia atrás que delega en repositorios especializados
 * (tenants, usuarios/autenticación, sesiones y API keys).
 */
export class TenantAuthRepository {
  private readonly tenantRepo: TenantRepository;
  private readonly userRepo: UserAuthRepository;
  private readonly sessionRepo: SessionRepository;
  private readonly apiKeyRepo: ApiKeyRepository;

  constructor(db: Database) {
    this.tenantRepo = new TenantRepository(db);
    this.userRepo = new UserAuthRepository();
    this.sessionRepo = new SessionRepository(db);
    this.apiKeyRepo = new ApiKeyRepository(db);
  }

  getTenantBySlug(slug: string) {
    return this.tenantRepo.getTenantBySlug(slug);
  }

  getTenantById(tenantId: string) {
    return this.tenantRepo.getTenantById(tenantId);
  }

  createTenant(input: {
    slug: string;
    name: string;
    plan?: TenantPlan | undefined;
  }) {
    return this.tenantRepo.createTenant(input);
  }

  createUser(
    scope: TenantScope,
    input: Parameters<UserAuthRepository["createUser"]>[1]
  ): Promise<SafeUserRecord> {
    return this.userRepo.createUser(scope, input);
  }

  getUserById(scope: TenantScope, userId: number): Promise<SafeUserRecord | null> {
    return this.userRepo.getUserById(scope, userId);
  }

  listUsers(scope: TenantScope, includeMaster = true): Promise<SafeUserRecord[]> {
    return this.userRepo.listUsers(scope, includeMaster);
  }

  updateUser(
    scope: TenantScope,
    userId: number,
    patch: Parameters<UserAuthRepository["updateUser"]>[2],
    actorRole?: UserRole
  ): Promise<SafeUserRecord> {
    return this.userRepo.updateUser(scope, userId, patch, actorRole);
  }

  changeUserPassword(
    scope: TenantScope,
    userId: number,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    return this.userRepo.changeUserPassword(
      scope,
      userId,
      currentPassword,
      newPassword
    );
  }

  authenticateDetailed(
    scope: TenantScope,
    usernameOrEmail: string,
    password: string
  ): Promise<AuthDetailedResult> {
    return this.userRepo.authenticateDetailed(scope, usernameOrEmail, password);
  }

  createSession(scope: TenantScope, user: SafeUserRecord): Promise<string> {
    return this.sessionRepo.createSession(scope, user);
  }

  resolveSessionByToken(rawToken: string) {
    return this.sessionRepo.resolveSessionByToken(rawToken);
  }

  revokeSessionByToken(rawToken: string): Promise<boolean> {
    return this.sessionRepo.revokeSessionByToken(rawToken);
  }

  countActiveSessions(scope: TenantScope): Promise<number> {
    return this.sessionRepo.countActiveSessions(scope);
  }

  createTenantApiKey(
    scope: TenantScope,
    clientName: string,
    role: UserRole = "operador"
  ): Promise<{ rawKey: string; keyHash: string }> {
    return this.apiKeyRepo.createTenantApiKey(scope, clientName, role);
  }

  validateApiKey(rawKey: string) {
    return this.apiKeyRepo.validateApiKey(rawKey);
  }

  listApiKeys(scope: TenantScope) {
    return this.apiKeyRepo.listApiKeys(scope);
  }

  revokeApiKey(scope: TenantScope, keyHash: string): Promise<boolean> {
    return this.apiKeyRepo.revokeApiKey(scope, keyHash);
  }
}

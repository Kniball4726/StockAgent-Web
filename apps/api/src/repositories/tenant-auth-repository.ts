import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
  LOCKOUT_SECONDS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  USER_ROLES,
  type TenantPlan,
  type UserRole,
} from "@stockagent/shared";
import { assertValidTenantId, type Database } from "../db/client.js";
import {
  apiKeys,
  apiSessions,
  loginAttempts,
  tenantSettings,
  tenants,
  users,
} from "../db/schema/index.js";
import {
  generateApiKey,
  generateSessionToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../security/crypto.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  runInTenantTx,
  type TenantScope,
} from "./base.js";

const SESSION_TTL_MS = 24 * 3600 * 1000;
const FAILED_WINDOW_MS = LOCKOUT_SECONDS * 1000;

export type UserRecord = typeof users.$inferSelect;
export type SafeUserRecord = Omit<UserRecord, "passwordHash">;

export interface AuthDetailedResult {
  status: "ok" | "invalid" | "inactive" | "locked";
  user: SafeUserRecord | null;
  retryAfterSeconds: number;
  attemptsLeft: number | null;
}

function toSafeUser(row: UserRecord): SafeUserRecord {
  const { passwordHash: _omitted, ...safe } = row;
  return safe;
}

export class TenantAuthRepository {
  constructor(private readonly db: Database) {}

  async getTenantBySlug(slug: string) {
    const clean = slug.trim();
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(sql`lower(${tenants.slug}) = lower(${clean})`)
      .limit(1);
    return row ?? null;
  }

  async getTenantById(tenantId: string) {
    const valid = assertValidTenantId(tenantId);
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, valid))
      .limit(1);
    return row ?? null;
  }

  async createTenant(input: {
    slug: string;
    name: string;
    plan?: TenantPlan | undefined;
  }) {
    const slug = input.slug.trim().toLowerCase();
    const name = input.name.trim();
    if (!slug || !name) {
      throw new ConflictError("El slug y el nombre del tenant son obligatorios.");
    }

    const existing = await this.getTenantBySlug(slug);
    if (existing) {
      throw new ConflictError(`Ya existe un tenant con slug '${slug}'.`);
    }

    const [created] = await this.db
      .insert(tenants)
      .values({
        slug,
        name,
        plan: input.plan ?? "free",
        active: true,
      })
      .returning();

    if (!created) {
      throw new Error("No se pudo crear el tenant.");
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${created.id}, true)`
      );
      await tx
        .insert(tenantSettings)
        .values({ tenantId: created.id })
        .onConflictDoNothing();
    });

    return created;
  }

  async createUser(
    scope: TenantScope,
    input: {
      username: string;
      password: string;
      role: UserRole;
      creatorRole?: UserRole | undefined;
      nombre?: string | undefined;
      email?: string | undefined;
      mustChangePassword?: boolean | undefined;
    }
  ): Promise<SafeUserRecord> {
    const username = input.username.trim();
    const email = (input.email ?? "").trim();
    const nombre = (input.nombre ?? "").trim();

    if (!username) {
      throw new ConflictError("El nombre de usuario es obligatorio.");
    }
    if (!USER_ROLES.includes(input.role)) {
      throw new ConflictError(`Rol inválido: '${input.role}'.`);
    }
    if (
      (input.role === "master" || input.role === "administrador") &&
      input.creatorRole &&
      input.creatorRole !== "master"
    ) {
      throw new ForbiddenError(
        "Solo un usuario con rol master puede crear administradores o masters."
      );
    }

    const passwordHash = hashPassword(input.password);

    return runInTenantTx(scope, async (tx, tenantId) => {
      const [dupUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenantId, tenantId),
            sql`lower(${users.username}) = lower(${username})`
          )
        )
        .limit(1);

      if (dupUser) {
        throw new ConflictError(`El usuario '${username}' ya existe en el tenant.`);
      }

      if (email) {
        const [dupEmail] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.tenantId, tenantId),
              sql`lower(${users.email}) = lower(${email})`
            )
          )
          .limit(1);
        if (dupEmail) {
          throw new ConflictError(`El correo '${email}' ya está registrado.`);
        }
      }

      const [created] = await tx
        .insert(users)
        .values({
          tenantId,
          username,
          passwordHash,
          role: input.role,
          active: true,
          mustChangePassword: input.mustChangePassword ?? false,
          nombre,
          email,
        })
        .returning();

      if (!created) {
        throw new Error("No se pudo crear el usuario.");
      }
      return toSafeUser(created);
    });
  }

  async getUserById(
    scope: TenantScope,
    userId: number
  ): Promise<SafeUserRecord | null> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [row] = await tx
        .select()
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
        .limit(1);
      return row ? toSafeUser(row) : null;
    });
  }

  async listUsers(
    scope: TenantScope,
    includeMaster = true
  ): Promise<SafeUserRecord[]> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const rows = await tx
        .select()
        .from(users)
        .where(eq(users.tenantId, tenantId))
        .orderBy(users.id);
      return rows
        .filter((u) => includeMaster || u.role !== "master")
        .map(toSafeUser);
    });
  }

  async updateUser(
    scope: TenantScope,
    userId: number,
    patch: {
      role?: UserRole | undefined;
      active?: boolean | undefined;
      nombre?: string | undefined;
      email?: string | undefined;
    },
    actorRole?: UserRole
  ): Promise<SafeUserRecord> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [existing] = await tx
        .select()
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
        .limit(1);

      if (!existing) {
        throw new NotFoundError(`Usuario ID ${userId} no encontrado.`);
      }

      if (
        existing.role === "master" &&
        actorRole &&
        actorRole !== "master"
      ) {
        throw new ForbiddenError(
          "Solo un usuario master puede modificar otra cuenta master."
        );
      }

      if (
        patch.role &&
        (patch.role === "master" || patch.role === "administrador") &&
        actorRole &&
        actorRole !== "master"
      ) {
        throw new ForbiddenError(
          "Solo un usuario master puede asignar roles de administrador o master."
        );
      }

      const [updated] = await tx
        .update(users)
        .set({
          role: patch.role ?? existing.role,
          active: patch.active ?? existing.active,
          nombre:
            patch.nombre !== undefined ? patch.nombre.trim() : existing.nombre,
          email: patch.email !== undefined ? patch.email.trim() : existing.email,
          updatedAt: new Date(),
        })
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
        .returning();

      if (!updated) {
        throw new Error("No se pudo actualizar el usuario.");
      }

      if (patch.active === false) {
        await tx
          .delete(apiSessions)
          .where(and(eq(apiSessions.tenantId, tenantId), eq(apiSessions.userId, userId)));
      }

      return toSafeUser(updated);
    });
  }

  async changeUserPassword(
    scope: TenantScope,
    userId: number,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const newHash = hashPassword(newPassword);
    await runInTenantTx(scope, async (tx, tenantId) => {
      const [existing] = await tx
        .select()
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
        .limit(1);
      if (!existing) {
        throw new NotFoundError(`Usuario ID ${userId} no encontrado.`);
      }
      if (!verifyPassword(currentPassword, existing.passwordHash)) {
        throw new ForbiddenError("La contraseña actual es incorrecta.");
      }
      await tx
        .update(users)
        .set({
          passwordHash: newHash,
          mustChangePassword: false,
          updatedAt: new Date(),
        })
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
    });
  }

  async authenticateDetailed(
    scope: TenantScope,
    usernameOrEmail: string,
    password: string
  ): Promise<AuthDetailedResult> {
    const identifier = usernameOrEmail.trim();
    if (!identifier || !password) {
      return {
        status: "invalid",
        user: null,
        retryAfterSeconds: 0,
        attemptsLeft: null,
      };
    }

    return runInTenantTx(scope, async (tx, tenantId) => {
      const now = new Date();
      const [userRow] = await tx
        .select()
        .from(users)
        .where(
          and(
            eq(users.tenantId, tenantId),
            sql`(lower(${users.username}) = lower(${identifier}) OR (${users.email} <> '' AND lower(${users.email}) = lower(${identifier})))`
          )
        )
        .limit(1);

      const attemptKey = userRow ? userRow.username : identifier;
      const [attempt] = await tx
        .select()
        .from(loginAttempts)
        .where(
          and(
            eq(loginAttempts.tenantId, tenantId),
            sql`lower(${loginAttempts.username}) = lower(${attemptKey})`
          )
        )
        .limit(1);

      if (attempt?.lockedUntil && attempt.lockedUntil.getTime() > now.getTime()) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((attempt.lockedUntil.getTime() - now.getTime()) / 1000)
        );
        return {
          status: "locked",
          user: null,
          retryAfterSeconds,
          attemptsLeft: 0,
        };
      }

      if (!userRow || !verifyPassword(password, userRow.passwordHash)) {
        const windowExpired =
          !attempt?.firstFailedAt ||
          now.getTime() - attempt.firstFailedAt.getTime() > FAILED_WINDOW_MS;
        const newCount = windowExpired ? 1 : (attempt?.failedCount ?? 0) + 1;
        const shouldLock = newCount >= MAX_FAILED_LOGIN_ATTEMPTS;
        const lockedUntil = shouldLock
          ? new Date(now.getTime() + LOCKOUT_SECONDS * 1000)
          : null;
        const firstFailedAt = windowExpired
          ? now
          : (attempt?.firstFailedAt ?? now);

        if (attempt) {
          await tx
            .update(loginAttempts)
            .set({ failedCount: newCount, firstFailedAt, lockedUntil })
            .where(eq(loginAttempts.id, attempt.id));
        } else {
          await tx.insert(loginAttempts).values({
            tenantId,
            username: attemptKey,
            failedCount: newCount,
            firstFailedAt,
            lockedUntil,
          });
        }

        if (shouldLock) {
          return {
            status: "locked",
            user: null,
            retryAfterSeconds: LOCKOUT_SECONDS,
            attemptsLeft: 0,
          };
        }
        return {
          status: "invalid",
          user: null,
          retryAfterSeconds: 0,
          attemptsLeft: Math.max(0, MAX_FAILED_LOGIN_ATTEMPTS - newCount),
        };
      }

      if (!userRow.active) {
        return {
          status: "inactive",
          user: toSafeUser(userRow),
          retryAfterSeconds: 0,
          attemptsLeft: null,
        };
      }

      if (attempt) {
        await tx
          .delete(loginAttempts)
          .where(eq(loginAttempts.id, attempt.id));
      }

      return {
        status: "ok",
        user: toSafeUser(userRow),
        retryAfterSeconds: 0,
        attemptsLeft: null,
      };
    });
  }

  async createSession(
    scope: TenantScope,
    user: SafeUserRecord
  ): Promise<string> {
    const rawToken = generateSessionToken();
    const tokenHash = hashToken(rawToken);
    const now = new Date();
    const expiredBefore = new Date(now.getTime() - SESSION_TTL_MS);

    await runInTenantTx(scope, async (tx, tenantId) => {
      await tx.insert(apiSessions).values({
        tokenHash,
        tenantId,
        userId: user.id,
        username: user.username,
        role: user.role,
        nombre: user.nombre || user.username,
        email: user.email,
        createdAt: now,
        lastActive: now,
      });
      await tx
        .delete(apiSessions)
        .where(
          and(
            eq(apiSessions.tenantId, tenantId),
            lt(apiSessions.lastActive, expiredBefore)
          )
        );
    });

    return rawToken;
  }

  /**
   * Resuelve una sesión a partir del Bearer token y verifica vigencia + usuario activo.
   */
  async resolveSessionByToken(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const [session] = await this.db
      .select()
      .from(apiSessions)
      .where(eq(apiSessions.tokenHash, tokenHash))
      .limit(1);

    if (!session) {
      return null;
    }

    const now = Date.now();
    if (now - session.lastActive.getTime() > SESSION_TTL_MS) {
      await this.db
        .delete(apiSessions)
        .where(eq(apiSessions.tokenHash, tokenHash));
      return null;
    }

    return runInTenantTx(
      { db: this.db, tenantId: session.tenantId },
      async (tx, tenantId) => {
        const [userRow] = await tx
          .select()
          .from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.id, session.userId)))
          .limit(1);

        if (!userRow || !userRow.active) {
          await tx
            .delete(apiSessions)
            .where(eq(apiSessions.tokenHash, tokenHash));
          return null;
        }

        const updatedAt = new Date();
        await tx
          .update(apiSessions)
          .set({
            lastActive: updatedAt,
            role: userRow.role,
            username: userRow.username,
            nombre: userRow.nombre || userRow.username,
            email: userRow.email,
          })
          .where(eq(apiSessions.tokenHash, tokenHash));

        return {
          tokenHash,
          tenantId,
          userId: userRow.id,
          username: userRow.username,
          role: userRow.role,
          nombre: userRow.nombre || userRow.username,
          email: userRow.email,
          lastActive: updatedAt,
        };
      }
    );
  }

  async revokeSessionByToken(rawToken: string): Promise<boolean> {
    const tokenHash = hashToken(rawToken);
    const deleted = await this.db
      .delete(apiSessions)
      .where(eq(apiSessions.tokenHash, tokenHash))
      .returning({ tokenHash: apiSessions.tokenHash });
    return deleted.length > 0;
  }

  async countActiveSessions(scope: TenantScope): Promise<number> {
    const validCutoff = new Date(Date.now() - SESSION_TTL_MS);
    return runInTenantTx(scope, async (tx, tenantId) => {
      const rows = await tx
        .select({ tokenHash: apiSessions.tokenHash })
        .from(apiSessions)
        .where(
          and(
            eq(apiSessions.tenantId, tenantId),
            sql`${apiSessions.lastActive} >= ${validCutoff}`
          )
        );
      return rows.length;
    });
  }

  async createTenantApiKey(
    scope: TenantScope,
    clientName: string,
    role: UserRole = "operador"
  ): Promise<{ rawKey: string; keyHash: string }> {
    const cleanName = clientName.trim();
    if (!cleanName) {
      throw new ConflictError("El nombre del cliente de API Key es obligatorio.");
    }
    const { rawKey, keyHash } = generateApiKey();
    await runInTenantTx(scope, async (tx, tenantId) => {
      await tx.insert(apiKeys).values({
        keyHash,
        tenantId,
        clientName: cleanName,
        role,
        active: true,
      });
    });
    return { rawKey, keyHash };
  }

  async validateApiKey(rawKey: string) {
    const clean = rawKey.trim();
    if (!clean) {
      return null;
    }
    const keyHash = hashToken(clean);
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.active, true)))
      .limit(1);

    if (!row) {
      return null;
    }

    await this.db
      .update(apiKeys)
      .set({ lastUsed: new Date() })
      .where(eq(apiKeys.keyHash, keyHash));

    return row;
  }

  async listApiKeys(scope: TenantScope) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      return tx
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.tenantId, tenantId))
        .orderBy(desc(apiKeys.createdAt));
    });
  }

  async revokeApiKey(scope: TenantScope, keyHash: string): Promise<boolean> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const updated = await tx
        .update(apiKeys)
        .set({ active: false })
        .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.keyHash, keyHash)))
        .returning({ keyHash: apiKeys.keyHash });
      if (updated.length === 0) {
        throw new NotFoundError("Clave API no encontrada.");
      }
      return true;
    });
  }
}

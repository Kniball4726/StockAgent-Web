import { and, eq, sql } from "drizzle-orm";
import {
  LOCKOUT_SECONDS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  USER_ROLES,
  type UserRole,
} from "@stockagent/shared";
import { apiSessions, loginAttempts, users } from "../../db/schema/index.js";
import { hashPassword, verifyPassword } from "../../security/crypto.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  runInTenantTx,
  type TenantScope,
} from "../base.js";

const FAILED_WINDOW_MS = LOCKOUT_SECONDS * 1000;

export type UserRecord = typeof users.$inferSelect;
export type SafeUserRecord = Omit<UserRecord, "passwordHash">;

export interface AuthDetailedResult {
  status: "ok" | "invalid" | "inactive" | "locked";
  user: SafeUserRecord | null;
  retryAfterSeconds: number;
  attemptsLeft: number | null;
}

export function toSafeUser(row: UserRecord): SafeUserRecord {
  const { passwordHash: _omitted, ...safe } = row;
  return safe;
}

export class UserAuthRepository {
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
        throw new ConflictError(
          `El usuario '${username}' ya existe en el tenant.`
        );
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

      if (existing.role === "master" && actorRole && actorRole !== "master") {
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
          .where(
            and(
              eq(apiSessions.tenantId, tenantId),
              eq(apiSessions.userId, userId)
            )
          );
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

      if (
        attempt?.lockedUntil &&
        attempt.lockedUntil.getTime() > now.getTime()
      ) {
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
}

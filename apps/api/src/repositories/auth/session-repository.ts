import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { apiSessions, users } from "../../db/schema/index.js";
import { generateSessionToken, hashToken } from "../../security/crypto.js";
import { runInTenantTx, type TenantScope } from "../base.js";
import type { SafeUserRecord } from "./user-repository.js";

const SESSION_TTL_MS = 24 * 3600 * 1000;

export class SessionRepository {
  constructor(private readonly db: Database) {}

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
          .where(
            and(eq(users.tenantId, tenantId), eq(users.id, session.userId))
          )
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
}

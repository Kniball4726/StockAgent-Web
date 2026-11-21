import { and, desc, eq } from "drizzle-orm";
import type { UserRole } from "@stockagent/shared";
import type { Database } from "../../db/client.js";
import { apiKeys } from "../../db/schema/index.js";
import { generateApiKey, hashToken } from "../../security/crypto.js";
import {
  ConflictError,
  NotFoundError,
  runInTenantTx,
  type TenantScope,
} from "../base.js";

export class ApiKeyRepository {
  constructor(private readonly db: Database) {}

  async createTenantApiKey(
    scope: TenantScope,
    clientName: string,
    role: UserRole = "operador"
  ): Promise<{ rawKey: string; keyHash: string }> {
    const cleanName = clientName.trim();
    if (!cleanName) {
      throw new ConflictError(
        "El nombre del cliente de API Key es obligatorio."
      );
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
        .where(
          and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.keyHash, keyHash))
        )
        .returning({ keyHash: apiKeys.keyHash });
      if (updated.length === 0) {
        throw new NotFoundError("Clave API no encontrada.");
      }
      return true;
    });
  }
}

import { eq } from "drizzle-orm";
import { tenantSettings } from "../db/schema/index.js";
import { decryptSecret, encryptSecret } from "../security/crypto.js";
import { runInTenantTx, type TenantScope } from "./base.js";

export interface MercadoLibreConfig {
  appId: string;
  clientSecret: string;
  sellerId: string;
  accessToken: string;
  refreshToken: string;
  activo: boolean;
  filtroEstado: string;
  horasAtras: number;
  autoDescontar: boolean;
  ultimaSincronizacion: string;
}

export interface MaskedMercadoLibreConfig {
  appId: string;
  sellerId: string;
  activo: boolean;
  filtroEstado: string;
  horasAtras: number;
  autoDescontar: boolean;
  ultimaSincronizacion: string;
  hasClientSecret: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
}

function readEnvFallback(names: readonly string[]): string {
  for (const name of names) {
    const val = process.env[name]?.trim();
    if (val) {
      return val;
    }
  }
  return "";
}

function tryDecryptSecret(raw: unknown, encryptionKey?: string): string {
  const str = typeof raw === "string" ? raw.trim() : "";
  if (!str) {
    return "";
  }
  try {
    return decryptSecret(str, encryptionKey);
  } catch {
    return "";
  }
}

export class TenantSettingsRepository {
  constructor(private readonly encryptionKey?: string | undefined) {}

  async getMercadoLibreConfig(scope: TenantScope): Promise<MercadoLibreConfig> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [row] = await tx
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, tenantId))
        .limit(1);

      const raw = (row?.mercadolibreConfig ?? {}) as Record<string, unknown>;

      const appId =
        String(raw.appId ?? "").trim() ||
        readEnvFallback(["STOCKAGENT_MELI_APP_ID", "MELI_APP_ID"]);
      const clientSecret =
        tryDecryptSecret(raw.clientSecret, this.encryptionKey) ||
        readEnvFallback(["STOCKAGENT_MELI_CLIENT_SECRET", "MELI_CLIENT_SECRET"]);
      const sellerId =
        String(raw.sellerId ?? "").trim() ||
        readEnvFallback(["STOCKAGENT_MELI_SELLER_ID", "MELI_SELLER_ID"]);
      const accessToken =
        tryDecryptSecret(raw.accessToken, this.encryptionKey) ||
        readEnvFallback(["STOCKAGENT_MELI_ACCESS_TOKEN", "MELI_ACCESS_TOKEN"]);
      const refreshToken =
        tryDecryptSecret(raw.refreshToken, this.encryptionKey) ||
        readEnvFallback(["STOCKAGENT_MELI_REFRESH_TOKEN", "MELI_REFRESH_TOKEN"]);

      const horasRaw = Number(raw.horasAtras ?? 48);

      return {
        appId,
        clientSecret,
        sellerId,
        accessToken,
        refreshToken,
        activo: Boolean(raw.activo ?? false),
        filtroEstado: String(raw.filtroEstado ?? "paid").trim() || "paid",
        horasAtras:
          Number.isFinite(horasRaw) && horasRaw > 0 ? Math.trunc(horasRaw) : 48,
        autoDescontar: Boolean(raw.autoDescontar ?? false),
        ultimaSincronizacion: String(raw.ultimaSincronizacion ?? ""),
      };
    });
  }

  async saveMercadoLibreConfig(
    scope: TenantScope,
    patch: { [K in keyof MercadoLibreConfig]?: MercadoLibreConfig[K] | undefined }
  ): Promise<MercadoLibreConfig> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const current = await this.getMercadoLibreConfig({
        ...scope,
        tenantId,
        tx,
      });
      const merged: MercadoLibreConfig = {
        appId: patch.appId !== undefined ? patch.appId.trim() : current.appId,
        clientSecret:
          patch.clientSecret !== undefined
            ? patch.clientSecret.trim()
            : current.clientSecret,
        sellerId:
          patch.sellerId !== undefined
            ? patch.sellerId.trim()
            : current.sellerId,
        accessToken:
          patch.accessToken !== undefined
            ? patch.accessToken.trim()
            : current.accessToken,
        refreshToken:
          patch.refreshToken !== undefined
            ? patch.refreshToken.trim()
            : current.refreshToken,
        activo: patch.activo !== undefined ? patch.activo : current.activo,
        filtroEstado:
          patch.filtroEstado !== undefined
            ? patch.filtroEstado.trim() || "paid"
            : current.filtroEstado,
        horasAtras:
          patch.horasAtras !== undefined
            ? Math.max(1, Math.min(720, Math.trunc(patch.horasAtras)))
            : current.horasAtras,
        autoDescontar:
          patch.autoDescontar !== undefined
            ? patch.autoDescontar
            : current.autoDescontar,
        ultimaSincronizacion:
          patch.ultimaSincronizacion !== undefined
            ? patch.ultimaSincronizacion
            : current.ultimaSincronizacion,
      };

      const storedPayload = {
        appId: merged.appId,
        clientSecret: merged.clientSecret
          ? encryptSecret(merged.clientSecret, this.encryptionKey)
          : "",
        sellerId: merged.sellerId,
        accessToken: merged.accessToken
          ? encryptSecret(merged.accessToken, this.encryptionKey)
          : "",
        refreshToken: merged.refreshToken
          ? encryptSecret(merged.refreshToken, this.encryptionKey)
          : "",
        activo: merged.activo,
        filtroEstado: merged.filtroEstado,
        horasAtras: merged.horasAtras,
        autoDescontar: merged.autoDescontar,
        ultimaSincronizacion: merged.ultimaSincronizacion,
      };

      await tx
        .insert(tenantSettings)
        .values({
          tenantId,
          mercadolibreConfig: storedPayload,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: tenantSettings.tenantId,
          set: {
            mercadolibreConfig: storedPayload,
            updatedAt: new Date(),
          },
        });

      return merged;
    });
  }

  static toMaskedConfig(cfg: MercadoLibreConfig): MaskedMercadoLibreConfig {
    return {
      appId: cfg.appId,
      sellerId: cfg.sellerId,
      activo: cfg.activo,
      filtroEstado: cfg.filtroEstado,
      horasAtras: cfg.horasAtras,
      autoDescontar: cfg.autoDescontar,
      ultimaSincronizacion: cfg.ultimaSincronizacion,
      hasClientSecret: Boolean(cfg.clientSecret),
      hasAccessToken: Boolean(cfg.accessToken),
      hasRefreshToken: Boolean(cfg.refreshToken),
    };
  }
}

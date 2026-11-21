import type { CatalogProductSnapshot, SimulationResult } from "@stockagent/shared";
import { DomainError, type TenantScope } from "../repositories/base.js";
import { OrderRepository } from "../repositories/order-repository.js";
import { ProductRepository } from "../repositories/product-repository.js";
import {
  TenantSettingsRepository,
  type MercadoLibreConfig,
} from "../repositories/tenant-settings-repository.js";
import type {
  ConfirmIngestionResult,
  IngestionService,
} from "../services/ingestion-service.js";
import { MercadoLibreOAuthClient } from "./mercado-libre/oauth-client.js";
import { mapMercadoLibreOrderToDocument } from "./mercado-libre/order-mapper.js";
import type {
  MappedMercadoLibreOrder,
  MercadoLibreRawOrder,
  MercadoLibreServiceOptions,
} from "./mercado-libre/types.js";

export {
  mapMercadoLibreOrderToDocument,
  MercadoLibreOAuthClient,
  type MappedMercadoLibreOrder,
  type MercadoLibreRawOrder,
  type MercadoLibreServiceOptions,
};

export class MercadoLibreService {
  private readonly oauthClient: MercadoLibreOAuthClient;

  constructor(
    private readonly settingsRepo: TenantSettingsRepository,
    private readonly productRepo: ProductRepository,
    private readonly orderRepo: OrderRepository,
    options: MercadoLibreServiceOptions = {}
  ) {
    this.oauthClient = new MercadoLibreOAuthClient(settingsRepo, options);
  }

  buildOAuthAuthorizeUrl(params: {
    appId: string;
    redirectUri: string;
    state?: string | undefined;
  }): string {
    return this.oauthClient.buildOAuthAuthorizeUrl(params);
  }

  exchangeOAuthCode(
    scope: TenantScope,
    input: { code: string; redirectUri: string }
  ): Promise<{ sellerId: string; expiresIn: number }> {
    return this.oauthClient.exchangeOAuthCode(scope, input);
  }

  refreshAccessToken(
    scope: TenantScope,
    existingCfg?: MercadoLibreConfig
  ): Promise<MercadoLibreConfig> {
    return this.oauthClient.refreshAccessToken(scope, existingCfg);
  }

  async verifyCredentials(
    scope: TenantScope
  ): Promise<{ ok: boolean; nickname: string; sellerId: string }> {
    const { response, cfg } = await this.oauthClient.fetchWithAutoRefresh(
      scope,
      `${this.oauthClient.apiBaseUrl}/users/me`
    );

    if (!response.ok) {
      throw new DomainError(
        "ML_VERIFY_FAILED",
        `Error HTTP ${response.status} al verificar cuenta en Mercado Libre.`,
        502
      );
    }

    const data = (await response.json()) as {
      id?: string | number;
      nickname?: string;
    };
    const sellerId = data.id ? String(data.id) : cfg.sellerId;
    if (sellerId && !cfg.sellerId) {
      await this.settingsRepo.saveMercadoLibreConfig(scope, { sellerId });
    }

    return {
      ok: true,
      nickname: String(data.nickname ?? "Desconocido"),
      sellerId,
    };
  }

  async fetchRecentOrders(
    scope: TenantScope,
    options: { horas?: number | undefined; limit?: number | undefined } = {}
  ): Promise<MercadoLibreRawOrder[]> {
    let cfg = await this.settingsRepo.getMercadoLibreConfig(scope);
    let sellerId = cfg.sellerId;
    if (!sellerId) {
      const profile = await this.verifyCredentials(scope);
      sellerId = profile.sellerId || "me";
      cfg = await this.settingsRepo.getMercadoLibreConfig(scope);
    }

    const horas = options.horas ?? cfg.horasAtras;
    const limit = Math.min(50, Math.max(1, options.limit ?? 50));
    const fromDate = new Date(Date.now() - horas * 3600 * 1000);
    const fromIso = fromDate.toISOString();

    const searchUrl = new URL(`${this.oauthClient.apiBaseUrl}/orders/search`);
    searchUrl.searchParams.set("seller", sellerId);
    searchUrl.searchParams.set("order.status", cfg.filtroEstado || "paid");
    searchUrl.searchParams.set("order.date_created.from", fromIso);
    searchUrl.searchParams.set("sort", "date_desc");
    searchUrl.searchParams.set("limit", String(limit));

    const { response } = await this.oauthClient.fetchWithAutoRefresh(
      scope,
      searchUrl.toString(),
      cfg
    );

    if (!response.ok) {
      throw new DomainError(
        "ML_ORDERS_FETCH_FAILED",
        `Error HTTP ${response.status} al consultar órdenes de Mercado Libre.`,
        502
      );
    }

    const data = (await response.json()) as {
      results?: MercadoLibreRawOrder[];
    };
    await this.settingsRepo.saveMercadoLibreConfig(scope, {
      ultimaSincronizacion: new Date().toISOString(),
    });

    return Array.isArray(data.results) ? data.results : [];
  }

  async syncOrdersWithIngestion(
    scope: TenantScope,
    ingestionService: IngestionService,
    options: {
      horas?: number | undefined;
      limit?: number | undefined;
      simulateOnly?: boolean | undefined;
      usuario?: string | undefined;
      txId?: string | undefined;
    } = {}
  ): Promise<{
    totalFetched: number;
    skippedAlreadyProcessed: string[];
    mappedOrders: MappedMercadoLibreOrder[];
    simulation: SimulationResult | null;
    confirmResult: ConfirmIngestionResult | null;
  }> {
    const rawOrders = await this.fetchRecentOrders(scope, {
      horas: options.horas,
      limit: options.limit,
    });

    const catalogRows = await this.productRepo.listProducts(scope, true);
    const catalog: CatalogProductSnapshot[] = catalogRows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      stock: p.stock,
      stockMinimo: p.stockMinimo,
      stockMaximo: p.stockMaximo,
      codBarras: p.codBarras,
      ubicacion: p.ubicacion,
    }));

    const allMapped = rawOrders.map((o) =>
      mapMercadoLibreOrderToDocument(o, catalog)
    );
    const existingNotas = await this.orderRepo.findExistingOrdersByNotas(
      scope,
      allMapped.map((m) => m.refPedido)
    );
    const existingHashes = await this.orderRepo.findConfirmedOrdersByHashes(
      scope,
      allMapped.map((m) => m.archivoHash)
    );

    const skippedAlreadyProcessed: string[] = [];
    const pendingOrders: MappedMercadoLibreOrder[] = [];

    for (const mapped of allMapped) {
      if (
        existingNotas.has(mapped.refPedido) ||
        existingHashes.has(mapped.archivoHash)
      ) {
        skippedAlreadyProcessed.push(mapped.refPedido);
        continue;
      }
      pendingOrders.push(mapped);
    }

    if (pendingOrders.length === 0) {
      return {
        totalFetched: rawOrders.length,
        skippedAlreadyProcessed,
        mappedOrders: [],
        simulation: null,
        confirmResult: null,
      };
    }

    const docs = pendingOrders.map((m) => m.ingestionDocument);
    const simulation = await ingestionService.simulate(scope, {
      operation: "descuento_pedidos",
      documents: docs,
      failOnUnmatched: false,
    });

    if (options.simulateOnly ?? true) {
      return {
        totalFetched: rawOrders.length,
        skippedAlreadyProcessed,
        mappedOrders: pendingOrders,
        simulation,
        confirmResult: null,
      };
    }

    const confirmResult = await ingestionService.confirm(scope, {
      txId: options.txId,
      operation: "descuento_pedidos",
      usuario: options.usuario,
      documents: docs,
      failOnUnmatched: false,
      sobrescribirStock: false,
    });

    return {
      totalFetched: rawOrders.length,
      skippedAlreadyProcessed,
      mappedOrders: pendingOrders,
      simulation,
      confirmResult,
    };
  }
}

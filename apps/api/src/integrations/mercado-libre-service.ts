import {
  resolverProductoEnCatalogo,
  type CatalogProductSnapshot,
  type IngestionDocumentInput,
  type SimulationResult,
} from "@stockagent/shared";
import { buscarCodigoPorDescripcionMl } from "../parsers/mercado-libre-parser.js";
import { DomainError } from "../repositories/base.js";
import { OrderRepository } from "../repositories/order-repository.js";
import { ProductRepository } from "../repositories/product-repository.js";
import {
  TenantSettingsRepository,
  type MercadoLibreConfig,
} from "../repositories/tenant-settings-repository.js";
import { hashSha256 } from "../security/crypto.js";
import type { TenantScope } from "../repositories/base.js";
import type {
  ConfirmIngestionResult,
  IngestionService,
} from "../services/ingestion-service.js";

const DEFAULT_API_BASE = "https://api.mercadolibre.com";
const DEFAULT_AUTH_BASE = "https://auth.mercadolibre.com.ar";

export interface MercadoLibreRawOrder {
  id: number | string;
  date_created?: string;
  buyer?: {
    first_name?: string;
    last_name?: string;
    nickname?: string;
  };
  shipping?: {
    id?: number | string;
  };
  order_items?: Array<{
    quantity?: number;
    unit_price?: number;
    item?: {
      title?: string;
      seller_sku?: string;
      seller_custom_field?: string;
    };
  }>;
}

export interface MappedMercadoLibreOrder {
  ordenId: string;
  refPedido: string;
  cliente: string;
  fecha: string;
  shippingId: string;
  archivoHash: string;
  itemsCoincidentes: Array<{
    codigo: string;
    nombre: string;
    cantidad: number;
    stockActual: number;
    precio: number;
    metodo: "SKU" | "Fuzzy Título";
    stockSuficiente: boolean;
  }>;
  itemsNoCoincidentes: Array<{
    titulo: string;
    sku: string;
    cantidad: number;
    precio: number;
    motivo: string;
  }>;
  totalUnidades: number;
  totalImporte: number;
  todosCoinciden: boolean;
  stockSuficiente: boolean;
  ingestionDocument: IngestionDocumentInput;
}

export function mapMercadoLibreOrderToDocument(
  orden: MercadoLibreRawOrder,
  catalog: readonly CatalogProductSnapshot[]
): MappedMercadoLibreOrder {
  const ordenId = String(orden.id ?? "").trim();
  const refPedido = `ML-${ordenId}`;
  const buyer = orden.buyer ?? {};
  const fullName =
    `${buyer.first_name ?? ""} ${buyer.last_name ?? ""}`.trim();
  const cliente =
    fullName || String(buyer.nickname ?? "Comprador Mercado Libre").trim();
  const fecha = String(orden.date_created ?? "")
    .slice(0, 19)
    .replace("T", " ");
  const shippingId = String(orden.shipping?.id ?? "").trim();
  const archivoHash = hashSha256(`ML_API_ORDER_${ordenId}`);

  const descripcionesCatalogo = new Map<string, string[]>();
  const catalogByCode = new Map<string, CatalogProductSnapshot>();
  for (const prod of catalog) {
    catalogByCode.set(prod.code.toLowerCase(), prod);
    if (prod.name) {
      const list = descripcionesCatalogo.get(prod.code) ?? [];
      if (!list.includes(prod.name)) {
        list.push(prod.name);
      }
      descripcionesCatalogo.set(prod.code, list);
    }
  }

  const itemsCoincidentes: MappedMercadoLibreOrder["itemsCoincidentes"] = [];
  const itemsNoCoincidentes: MappedMercadoLibreOrder["itemsNoCoincidentes"] =
    [];

  for (const elem of orden.order_items ?? []) {
    const itObj = elem.item ?? {};
    const skuRaw = String(
      itObj.seller_sku ?? itObj.seller_custom_field ?? ""
    ).trim();
    const titulo = String(itObj.title ?? "").trim();
    const cantidad = Math.max(1, Math.trunc(Number(elem.quantity ?? 1)));
    const precio = Number(elem.unit_price ?? 0);

    let matchedProd: CatalogProductSnapshot | null = null;
    let metodo: "SKU" | "Fuzzy Título" = "SKU";
    let motivo = "";

    if (skuRaw) {
      matchedProd = resolverProductoEnCatalogo(catalog, skuRaw);
    }

    if (!matchedProd && titulo) {
      const fuzzy = buscarCodigoPorDescripcionMl(titulo, descripcionesCatalogo);
      if (fuzzy.codigo) {
        matchedProd = catalogByCode.get(fuzzy.codigo.toLowerCase()) ?? null;
        metodo = "Fuzzy Título";
      } else {
        motivo = fuzzy.motivo;
      }
    }

    if (matchedProd) {
      itemsCoincidentes.push({
        codigo: matchedProd.code,
        nombre: matchedProd.name,
        cantidad,
        stockActual: matchedProd.stock,
        precio,
        metodo,
        stockSuficiente: matchedProd.stock >= cantidad,
      });
    } else {
      itemsNoCoincidentes.push({
        titulo,
        sku: skuRaw,
        cantidad,
        precio,
        motivo: motivo || "Sin coincidencia en catálogo",
      });
    }
  }

  const totalUnidades = itemsCoincidentes.reduce(
    (acc, it) => acc + it.cantidad,
    0
  );
  const totalImporte = itemsCoincidentes.reduce(
    (acc, it) => acc + it.cantidad * it.precio,
    0
  );

  const ingestionItems = [
    ...itemsCoincidentes.map((it) => ({
      codigo: it.codigo,
      descripcion: it.nombre,
      cantidad: it.cantidad,
      origenRemito: refPedido,
    })),
    ...itemsNoCoincidentes.map((it) => ({
      codigo: `UNMATCHED:${(it.sku || it.titulo).slice(0, 48)}`,
      descripcion: it.titulo || it.sku || "Ítem Mercado Libre",
      cantidad: it.cantidad,
      origenRemito: refPedido,
    })),
  ];

  return {
    ordenId,
    refPedido,
    cliente,
    fecha,
    shippingId,
    archivoHash,
    itemsCoincidentes,
    itemsNoCoincidentes,
    totalUnidades,
    totalImporte,
    todosCoinciden:
      itemsNoCoincidentes.length === 0 && itemsCoincidentes.length > 0,
    stockSuficiente: itemsCoincidentes.every((it) => it.stockSuficiente),
    ingestionDocument: {
      notaPedido: refPedido,
      numeroPedido: refPedido,
      cliente,
      bultos: 1,
      logistica: "Transporte",
      armador: "",
      tipoArchivo: "docx",
      nombreArchivo: `ML_API_${ordenId}.docx`,
      fechaRetiro: "",
      archivoHash,
      numeroGuia: shippingId,
      canal: "mercado_libre",
      items: ingestionItems,
    },
  };
}

export interface MercadoLibreServiceOptions {
  apiBaseUrl?: string | undefined;
  authBaseUrl?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

export class MercadoLibreService {
  private readonly apiBaseUrl: string;
  private readonly authBaseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly settingsRepo: TenantSettingsRepository,
    private readonly productRepo: ProductRepository,
    private readonly orderRepo: OrderRepository,
    options: MercadoLibreServiceOptions = {}
  ) {
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE).replace(
      /\/+$/,
      ""
    );
    this.authBaseUrl = (options.authBaseUrl ?? DEFAULT_AUTH_BASE).replace(
      /\/+$/,
      ""
    );
    this.fetchFn = options.fetchFn ?? fetch;
  }

  buildOAuthAuthorizeUrl(params: {
    appId: string;
    redirectUri: string;
    state?: string | undefined;
  }): string {
    const cleanAppId = params.appId.trim();
    const cleanRedirect = params.redirectUri.trim();
    if (!cleanAppId || !cleanRedirect) {
      throw new DomainError(
        "ML_OAUTH_CONFIG_MISSING",
        "App ID y Redirect URI son obligatorios para generar el enlace OAuth.",
        400
      );
    }
    const url = new URL(`${this.authBaseUrl}/authorization`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cleanAppId);
    url.searchParams.set("redirect_uri", cleanRedirect);
    if (params.state?.trim()) {
      url.searchParams.set("state", params.state.trim());
    }
    return url.toString();
  }

  async exchangeOAuthCode(
    scope: TenantScope,
    input: { code: string; redirectUri: string }
  ): Promise<{ sellerId: string; expiresIn: number }> {
    const cfg = await this.settingsRepo.getMercadoLibreConfig(scope);
    if (!cfg.appId || !cfg.clientSecret) {
      throw new DomainError(
        "ML_CREDENTIALS_INCOMPLETE",
        "Configura App ID y Client Secret antes de autorizar OAuth.",
        400
      );
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfg.appId,
      client_secret: cfg.clientSecret,
      code: input.code.trim(),
      redirect_uri: input.redirectUri.trim(),
    });

    const resp = await this.fetchFn(`${this.apiBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "StockAgent-Web/1.0",
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      throw new DomainError(
        "ML_OAUTH_EXCHANGE_FAILED",
        `Error HTTP ${resp.status} al canjear código OAuth: ${detail}`,
        502
      );
    }

    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      user_id?: string | number;
      expires_in?: number;
    };

    if (!data.access_token) {
      throw new DomainError(
        "ML_OAUTH_INVALID_RESPONSE",
        "Mercado Libre no retornó access_token.",
        502
      );
    }

    const sellerId = data.user_id ? String(data.user_id) : cfg.sellerId;
    await this.settingsRepo.saveMercadoLibreConfig(scope, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? cfg.refreshToken,
      sellerId,
      activo: true,
    });

    return {
      sellerId,
      expiresIn: Number(data.expires_in ?? 21600),
    };
  }

  async refreshAccessToken(
    scope: TenantScope,
    existingCfg?: MercadoLibreConfig
  ): Promise<MercadoLibreConfig> {
    const cfg =
      existingCfg ?? (await this.settingsRepo.getMercadoLibreConfig(scope));
    if (!cfg.appId || !cfg.clientSecret || !cfg.refreshToken) {
      throw new DomainError(
        "ML_REFRESH_MISSING",
        "Faltan App ID, Client Secret o Refresh Token para renovar el token.",
        400
      );
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: cfg.appId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
    });

    const resp = await this.fetchFn(`${this.apiBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "StockAgent-Web/1.0",
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      throw new DomainError(
        "ML_TOKEN_REFRESH_FAILED",
        `Error HTTP ${resp.status} al renovar token de Mercado Libre: ${detail}`,
        502
      );
    }

    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      user_id?: string | number;
    };

    if (!data.access_token) {
      throw new DomainError(
        "ML_TOKEN_REFRESH_FAILED",
        "Mercado Libre no retornó un access_token válido.",
        502
      );
    }

    return this.settingsRepo.saveMercadoLibreConfig(scope, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? cfg.refreshToken,
      sellerId: data.user_id && !cfg.sellerId ? String(data.user_id) : cfg.sellerId,
    });
  }

  private async fetchWithAutoRefresh(
    scope: TenantScope,
    url: string,
    cfgInitial?: MercadoLibreConfig
  ): Promise<{ response: Response; cfg: MercadoLibreConfig }> {
    let cfg =
      cfgInitial ?? (await this.settingsRepo.getMercadoLibreConfig(scope));
    if (!cfg.accessToken) {
      throw new DomainError(
        "ML_ACCESS_TOKEN_MISSING",
        "No hay Access Token de Mercado Libre configurado para este tenant.",
        400
      );
    }

    const doFetch = (token: string) =>
      this.fetchFn(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": "StockAgent-Web/1.0",
        },
      });

    let response = await doFetch(cfg.accessToken);
    if (response.status === 401 && cfg.refreshToken) {
      cfg = await this.refreshAccessToken(scope, cfg);
      response = await doFetch(cfg.accessToken);
    }

    return { response, cfg };
  }

  async verifyCredentials(
    scope: TenantScope
  ): Promise<{ ok: boolean; nickname: string; sellerId: string }> {
    const { response, cfg } = await this.fetchWithAutoRefresh(
      scope,
      `${this.apiBaseUrl}/users/me`
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

    const searchUrl = new URL(`${this.apiBaseUrl}/orders/search`);
    searchUrl.searchParams.set("seller", sellerId);
    searchUrl.searchParams.set("order.status", cfg.filtroEstado || "paid");
    searchUrl.searchParams.set("order.date_created.from", fromIso);
    searchUrl.searchParams.set("sort", "date_desc");
    searchUrl.searchParams.set("limit", String(limit));

    const { response } = await this.fetchWithAutoRefresh(
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

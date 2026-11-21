import { DomainError, type TenantScope } from "../../repositories/base.js";
import type {
  MercadoLibreConfig,
  TenantSettingsRepository,
} from "../../repositories/tenant-settings-repository.js";
import {
  DEFAULT_API_BASE,
  DEFAULT_AUTH_BASE,
  type MercadoLibreServiceOptions,
} from "./types.js";

export class MercadoLibreOAuthClient {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly settingsRepo: TenantSettingsRepository,
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
      sellerId:
        data.user_id && !cfg.sellerId ? String(data.user_id) : cfg.sellerId,
    });
  }

  async fetchWithAutoRefresh(
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
}

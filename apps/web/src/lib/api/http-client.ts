import {
  normalizeApiBaseUrl,
  resolveEffectiveApiBaseUrl,
} from "./url-config";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly isNetworkError: boolean;
  readonly issues?: unknown;

  constructor(params: {
    message: string;
    status?: number;
    code?: string;
    isNetworkError?: boolean;
    issues?: unknown;
  }) {
    super(params.message);
    this.name = "ApiClientError";
    this.status = params.status ?? 0;
    this.code = params.code ?? "API_ERROR";
    this.isNetworkError = Boolean(params.isNetworkError);
    if (params.issues !== undefined) {
      this.issues = params.issues;
    }
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export interface HttpRequestOptions {
  skipAuthRedirect?: boolean;
}

export class BaseHttpClient {
  private baseUrl: string;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized?: () => void;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = normalizeApiBaseUrl(
      options.baseUrl ?? resolveEffectiveApiBaseUrl()
    );
    this.getToken = options.getToken;
    if (options.onUnauthorized) {
      this.onUnauthorized = options.onUnauthorized;
    }
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  setBaseUrl(nextUrl: string): void {
    this.baseUrl = normalizeApiBaseUrl(nextUrl);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  buildUrl(path: string): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${cleanPath}`;
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const headers = new Headers(init.headers);
    const token = this.getToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const isFormData =
      typeof FormData !== "undefined" && init.body instanceof FormData;
    if (!isFormData && init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.buildUrl(path), {
        ...init,
        headers,
      });
    } catch (error) {
      throw new ApiClientError({
        message:
          error instanceof Error
            ? `Sin conexión con el servidor (${error.message}).`
            : "Sin conexión con el servidor.",
        isNetworkError: true,
        code: "NETWORK_ERROR",
      });
    }

    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    if (text.trim().length > 0) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      if (response.status === 401 && !opts.skipAuthRedirect) {
        this.onUnauthorized?.();
      }
      const errObj =
        data?.error && typeof data.error === "object"
          ? (data.error as Record<string, unknown>)
          : null;
      const msg = String(
        data?.detail ??
          data?.message ??
          errObj?.message ??
          `Error HTTP ${response.status}`
      );
      const code = String(errObj?.code ?? `HTTP_${response.status}`);
      throw new ApiClientError({
        message: msg,
        status: response.status,
        code,
        isNetworkError: response.status >= 502,
        issues: errObj?.issues,
      });
    }

    return (data ?? {}) as T;
  }

  async downloadBlob(path: string, errorMessagePrefix: string): Promise<Blob> {
    const headers = new Headers();
    const token = this.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await this.fetchImpl(this.buildUrl(path), {
      method: "GET",
      headers,
    });
    if (!response.ok) {
      if (response.status === 401) {
        this.onUnauthorized?.();
      }
      throw new ApiClientError({
        message: `${errorMessagePrefix} (${response.status}).`,
        status: response.status,
      });
    }
    return response.blob();
  }
}

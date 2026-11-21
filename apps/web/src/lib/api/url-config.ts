const API_URL_STORAGE_KEY = "stockagent_api_url";

export function normalizeApiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function getSavedApiBaseUrlOverride(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return normalizeApiBaseUrl(
      window.localStorage.getItem(API_URL_STORAGE_KEY) ?? ""
    );
  } catch {
    return "";
  }
}

export function saveApiBaseUrlOverride(url: string): string {
  const normalized = normalizeApiBaseUrl(url);
  if (typeof window !== "undefined") {
    try {
      if (!normalized) {
        window.localStorage.removeItem(API_URL_STORAGE_KEY);
      } else {
        window.localStorage.setItem(API_URL_STORAGE_KEY, normalized);
      }
    } catch {
      // Ignorar fallos de almacenamiento privado
    }
  }
  return normalized;
}

export function resolveEffectiveApiBaseUrl(): string {
  const override = getSavedApiBaseUrlOverride();
  if (override) {
    return override;
  }

  // En desarrollo Vite usamos proxy mismo-origen (`/api` -> backend) para evitar CORS y soportar LAN móvil
  if (import.meta.env.DEV) {
    return "";
  }

  const configured = normalizeApiBaseUrl(import.meta.env.VITE_API_URL ?? "");
  if (!configured) {
    return "";
  }

  if (typeof window !== "undefined") {
    const isLocalHost =
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost";
    const configuredIsLocal =
      configured.includes("127.0.0.1") || configured.includes("localhost");
    if (!isLocalHost && configuredIsLocal) {
      return "";
    }
  }

  return configured;
}

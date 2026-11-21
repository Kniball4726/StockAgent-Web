import type { BaseHttpClient } from "./http-client";
import type {
  AdminNotificationRow,
  AuditLogRow,
  ChatMessageRow,
  MaskedMercadoLibreConfigDto,
  MercadoLibreConfigPatch,
  SaasUsageResponse,
  SyncMercadoLibreResponse,
  TenantBackupExportResponse,
} from "./types";

export class AdminIntegrationsApi {
  constructor(private readonly http: BaseHttpClient) {}

  listChatMessages(
    limit = 60
  ): Promise<{ ok: boolean; mensajes: ChatMessageRow[] }> {
    return this.http.request(`/api/v1/chat/mensajes?limit=${limit}`, {
      method: "GET",
    });
  }

  sendChatMessage(
    mensaje: string,
    destinatario = "Todos"
  ): Promise<{ ok: boolean; mensaje: ChatMessageRow }> {
    return this.http.request("/api/v1/chat/mensajes", {
      method: "POST",
      body: JSON.stringify({ mensaje, destinatario }),
    });
  }

  markChatRead(): Promise<{ ok: boolean }> {
    return this.http.request("/api/v1/chat/marcar-leidos", { method: "POST" });
  }

  listNotifications(
    soloNoLeidas = false,
    limit = 40
  ): Promise<{ ok: boolean; notificaciones: AdminNotificationRow[] }> {
    return this.http.request(
      `/api/v1/notificaciones?solo_no_leidas=${soloNoLeidas}&limit=${limit}`,
      { method: "GET" }
    );
  }

  markNotificationsRead(id?: number): Promise<{ ok: boolean }> {
    return this.http.request("/api/v1/notificaciones/leer", {
      method: "POST",
      body: JSON.stringify(id !== undefined ? { id } : {}),
    });
  }

  listAuditLogs(limit = 80): Promise<{ ok: boolean; logs: AuditLogRow[] }> {
    return this.http.request(`/api/v1/auditoria?limit=${limit}`, {
      method: "GET",
    });
  }

  getMercadoLibreConfig(): Promise<{
    ok: boolean;
    config: MaskedMercadoLibreConfigDto;
  }> {
    return this.http.request("/api/v1/integrations/mercadolibre/config", {
      method: "GET",
    });
  }

  updateMercadoLibreConfig(
    patch: MercadoLibreConfigPatch
  ): Promise<{ ok: boolean; config: MaskedMercadoLibreConfigDto }> {
    return this.http.request("/api/v1/integrations/mercadolibre/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  }

  getMercadoLibreOAuthUrl(
    redirectUri: string,
    state = ""
  ): Promise<{ ok: boolean; url: string }> {
    const params = new URLSearchParams({ redirectUri });
    if (state) params.set("state", state);
    return this.http.request(
      `/api/v1/integrations/mercadolibre/oauth-url?${params.toString()}`,
      { method: "GET" }
    );
  }

  submitMercadoLibreOAuthCallback(
    code: string,
    redirectUri: string
  ): Promise<{ ok: boolean; sellerId: string }> {
    return this.http.request("/api/v1/integrations/mercadolibre/oauth-callback", {
      method: "POST",
      body: JSON.stringify({ code, redirectUri }),
    });
  }

  verifyMercadoLibre(): Promise<{
    ok: boolean;
    nickname?: string;
    sellerId?: string;
  }> {
    return this.http.request("/api/v1/integrations/mercadolibre/verify", {
      method: "POST",
    });
  }

  syncMercadoLibreOrders(simulateOnly = true): Promise<SyncMercadoLibreResponse> {
    return this.http.request("/api/v1/integrations/mercadolibre/orders/sync", {
      method: "POST",
      body: JSON.stringify({ simulateOnly }),
    });
  }

  getSaasUsage(): Promise<SaasUsageResponse> {
    return this.http.request("/api/v1/saas/usage", { method: "GET" });
  }

  exportTenantBackup(): Promise<TenantBackupExportResponse> {
    return this.http.request("/api/v1/saas/backup/export", { method: "POST" });
  }
}

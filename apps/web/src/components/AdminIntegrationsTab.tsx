import {
  DatabaseBackup,
  KeyRound,
  RefreshCw,
  ScrollText,
  ShoppingBag,
  Users,
} from "lucide-react";
import { useState } from "react";
import type { UsuarioResponse } from "@stockagent/shared";
import type { StockAgentApiClient } from "../lib/api-client";
import { ApiKeysSection } from "./admin/ApiKeysSection";
import { AuditLogsSection } from "./admin/AuditLogsSection";
import { MercadoLibreSection } from "./admin/MercadoLibreSection";
import { SaasQuotasSection } from "./admin/SaasQuotasSection";
import type { AdminBanner, AdminSubTab } from "./admin/types";
import { UsersAdminSection } from "./admin/UsersAdminSection";

interface AdminIntegrationsTabProps {
  api: StockAgentApiClient;
  user: UsuarioResponse;
}

export function AdminIntegrationsTab({ api, user }: AdminIntegrationsTabProps) {
  const [subTab, setSubTab] = useState<AdminSubTab>("users");
  const [refreshTick, setRefreshTick] = useState(0);
  const [banner, setBanner] = useState<AdminBanner | null>(null);
  const isMaster = user.role === "master";

  function handleSelectTab(next: AdminSubTab) {
    setBanner(null);
    setSubTab(next);
  }

  function handleReload() {
    setBanner(null);
    setRefreshTick((t) => t + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Administración e Integraciones
          </h2>
          <p className="text-xs text-slate-400">
            Control de usuarios (SoD), Mercado Libre OAuth2, API Keys y auditoría
          </p>
        </div>
        <button
          type="button"
          onClick={handleReload}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Recargar
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleSelectTab("users")}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium ${
            subTab === "users"
              ? "bg-sky-500 text-slate-950"
              : "border border-slate-700 bg-slate-900 text-slate-300"
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Usuarios y SoD
        </button>
        <button
          type="button"
          onClick={() => handleSelectTab("mercadolibre")}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium ${
            subTab === "mercadolibre"
              ? "bg-sky-500 text-slate-950"
              : "border border-slate-700 bg-slate-900 text-slate-300"
          }`}
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          Mercado Libre
        </button>
        {isMaster && (
          <button
            type="button"
            onClick={() => handleSelectTab("apikeys")}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium ${
              subTab === "apikeys"
                ? "bg-sky-500 text-slate-950"
                : "border border-slate-700 bg-slate-900 text-slate-300"
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            API Keys
          </button>
        )}
        <button
          type="button"
          onClick={() => handleSelectTab("audit")}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium ${
            subTab === "audit"
              ? "bg-sky-500 text-slate-950"
              : "border border-slate-700 bg-slate-900 text-slate-300"
          }`}
        >
          <ScrollText className="h-3.5 w-3.5" />
          Auditoría
        </button>
        <button
          type="button"
          onClick={() => handleSelectTab("saas")}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium ${
            subTab === "saas"
              ? "bg-sky-500 text-slate-950"
              : "border border-slate-700 bg-slate-900 text-slate-300"
          }`}
        >
          <DatabaseBackup className="h-3.5 w-3.5" />
          SaaS y Backups
        </button>
      </div>

      {banner && (
        <div
          role={banner.type === "err" ? "alert" : "status"}
          className={`rounded-xl border p-3 text-xs ${
            banner.type === "err"
              ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {banner.text}
        </div>
      )}

      {subTab === "users" && (
        <UsersAdminSection
          api={api}
          isMaster={isMaster}
          refreshTick={refreshTick}
          onBanner={setBanner}
        />
      )}
      {subTab === "mercadolibre" && (
        <MercadoLibreSection
          api={api}
          refreshTick={refreshTick}
          onBanner={setBanner}
        />
      )}
      {subTab === "apikeys" && isMaster && (
        <ApiKeysSection
          api={api}
          refreshTick={refreshTick}
          onBanner={setBanner}
        />
      )}
      {subTab === "audit" && (
        <AuditLogsSection
          api={api}
          refreshTick={refreshTick}
          onBanner={setBanner}
        />
      )}
      {subTab === "saas" && (
        <SaasQuotasSection
          api={api}
          isMaster={isMaster}
          refreshTick={refreshTick}
          onBanner={setBanner}
        />
      )}
    </div>
  );
}

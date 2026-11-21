import { DatabaseBackup } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  SaasUsageResponse,
  StockAgentApiClient,
} from "../../lib/api-client";
import { formatBytes, formatDateTime } from "../../lib/rbac";
import type { AdminBanner } from "./types";

interface SaasQuotasSectionProps {
  api: StockAgentApiClient;
  isMaster: boolean;
  refreshTick: number;
  onBanner: (banner: AdminBanner | null) => void;
}

export function SaasQuotasSection({
  api,
  isMaster,
  refreshTick,
  onBanner,
}: SaasQuotasSectionProps) {
  const [saasUsage, setSaasUsage] = useState<SaasUsageResponse | null>(null);
  const [lastBackupMeta, setLastBackupMeta] = useState<{
    sha256Checksum: string;
    exportedAt: string;
    counts: Record<string, number>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUsage = useCallback(async () => {
    try {
      const res = await api.getSaasUsage();
      setSaasUsage(res);
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "Error cargando cuotas SaaS del tenant.",
      });
    }
  }, [api, onBanner]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage, refreshTick]);

  async function handleExportTenantBackup() {
    setBusy(true);
    onBanner(null);
    try {
      const res = await api.exportTenantBackup();
      const snapshot = res.snapshot;
      setLastBackupMeta({
        sha256Checksum: snapshot.sha256Checksum,
        exportedAt: snapshot.exportedAt,
        counts: snapshot.counts,
      });

      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `backup-${snapshot.tenantSlug}-${snapshot.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      onBanner({
        type: "ok",
        text: `Backup SHA-256 exportado (${snapshot.sha256Checksum.slice(0, 16)}...).`,
      });
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "No se pudo exportar el backup.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {saasUsage && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Plan SaaS: {saasUsage.tenant.name} ({saasUsage.tenant.slug})
              </h3>
              <p className="text-xs text-slate-400">
                Tier{" "}
                <strong className="uppercase text-sky-300">
                  {saasUsage.tenant.plan}
                </strong>{" "}
                · Estado:{" "}
                {saasUsage.withinLimits ? "Dentro de cuota" : "Cuota excedida"}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-xl bg-slate-950 p-3">
              <span className="text-slate-400">Usuarios activos</span>
              <p className="mt-1 text-base font-bold text-white tabular-nums">
                {saasUsage.usage.usersCount} / {saasUsage.quotas.maxUsers}
              </p>
            </div>
            <div className="rounded-xl bg-slate-950 p-3">
              <span className="text-slate-400">Productos catálogo</span>
              <p className="mt-1 text-base font-bold text-white tabular-nums">
                {saasUsage.usage.productsCount} / {saasUsage.quotas.maxProducts}
              </p>
            </div>
            <div className="rounded-xl bg-slate-950 p-3">
              <span className="text-slate-400">Almacenamiento archivos</span>
              <p className="mt-1 text-base font-bold text-white tabular-nums">
                {formatBytes(saasUsage.usage.storageBytes)} /{" "}
                {formatBytes(saasUsage.quotas.maxStorageBytes)}
              </p>
            </div>
          </div>
        </div>
      )}

      {isMaster ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Copia de Seguridad Lógica (JSON firmado SHA-256)
              </h3>
              <p className="text-slate-400">
                Exporta catálogo, pedidos, movimientos, auditoría y metadatos
                aislados del tenant.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExportTenantBackup()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
            >
              <DatabaseBackup className="h-4 w-4" />
              Exportar Backup
            </button>
          </div>
          {lastBackupMeta && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 font-mono text-[11px] text-emerald-200">
              SHA-256: {lastBackupMeta.sha256Checksum} ·{" "}
              {formatDateTime(lastBackupMeta.exportedAt)}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
          Solo usuarios con rol <strong>Master</strong> pueden exportar snapshots
          completos de respaldo.
        </div>
      )}
    </div>
  );
}

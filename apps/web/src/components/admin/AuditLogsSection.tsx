import { useCallback, useEffect, useState } from "react";
import type { AuditLogRow, StockAgentApiClient } from "../../lib/api-client";
import { formatDateTime } from "../../lib/rbac";
import type { AdminBanner } from "./types";

interface AuditLogsSectionProps {
  api: StockAgentApiClient;
  refreshTick: number;
  onBanner: (banner: AdminBanner | null) => void;
}

export function AuditLogsSection({
  api,
  refreshTick,
  onBanner,
}: AuditLogsSectionProps) {
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);

  const loadLogs = useCallback(async () => {
    try {
      const res = await api.listAuditLogs(80);
      setAuditLogs(res.logs);
    } catch (err) {
      onBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error cargando auditoría.",
      });
    }
  }, [api, onBanner]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs, refreshTick]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400">
            <th className="py-2 pr-3 font-medium">Fecha</th>
            <th className="py-2 pr-3 font-medium">Usuario</th>
            <th className="py-2 pr-3 font-medium">Acción</th>
            <th className="py-2 font-medium">Detalle</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {auditLogs.map((log) => (
            <tr key={log.id}>
              <td className="py-2 pr-3 text-slate-400">
                {formatDateTime(log.createdAt)}
              </td>
              <td className="py-2 pr-3 font-medium text-sky-300">
                {log.usuario}
              </td>
              <td className="py-2 pr-3 font-mono text-slate-200">
                {log.accion}
              </td>
              <td className="py-2 text-slate-300">{log.detalle}</td>
            </tr>
          ))}
          {auditLogs.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-slate-500">
                No hay eventos de auditoría registrados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

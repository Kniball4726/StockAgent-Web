import { CheckCircle2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserRole } from "@stockagent/shared";
import type { StockAgentApiClient, TenantApiKeyRow } from "../../lib/api-client";
import { formatDateTime, formatRoleLabel } from "../../lib/rbac";
import type { AdminBanner } from "./types";

interface ApiKeysSectionProps {
  api: StockAgentApiClient;
  refreshTick: number;
  onBanner: (banner: AdminBanner | null) => void;
}

export function ApiKeysSection({
  api,
  refreshTick,
  onBanner,
}: ApiKeysSectionProps) {
  const [apiKeys, setApiKeys] = useState<TenantApiKeyRow[]>([]);
  const [keyClientName, setKeyClientName] = useState("");
  const [keyRole, setKeyRole] = useState<UserRole>("consulta");
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      const res = await api.listApiKeys();
      setApiKeys(res.api_keys);
    } catch (err) {
      onBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error cargando API Keys.",
      });
    }
  }, [api, onBanner]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys, refreshTick]);

  async function handleCreateApiKey(e: FormEvent) {
    e.preventDefault();
    if (!keyClientName.trim()) return;
    setBusy(true);
    onBanner(null);
    try {
      const res = await api.createApiKey({
        client_name: keyClientName.trim(),
        role: keyRole,
      });
      setGeneratedRawKey(res.api_key);
      setKeyClientName("");
      await loadKeys();
    } catch (err) {
      onBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error creando API Key.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeApiKey(keyHash: string) {
    try {
      await api.revokeApiKey(keyHash);
      await loadKeys();
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "No se pudo revocar la API Key.",
      });
    }
  }

  return (
    <div className="space-y-5">
      {generatedRawKey && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-100">
          <p className="flex items-center gap-1.5 font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Clave API generada (copiala ahora, no volverá a mostrarse):
          </p>
          <code className="mt-2 block break-all rounded-lg bg-slate-950 p-2 font-mono text-emerald-200">
            {generatedRawKey}
          </code>
        </div>
      )}

      <form
        onSubmit={handleCreateApiKey}
        className="flex flex-wrap gap-2 rounded-2xl border border-slate-800 bg-slate-900/75 p-4"
      >
        <input
          type="text"
          value={keyClientName}
          onChange={(e) => setKeyClientName(e.target.value)}
          placeholder="Nombre cliente / ERP..."
          required
          className="flex-1 min-w-[200px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
        />
        <select
          value={keyRole}
          onChange={(e) => setKeyRole(e.target.value as UserRole)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
        >
          <option value="consulta">Consulta</option>
          <option value="operador">Operador</option>
          <option value="picker">Picker</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
        >
          Emitir API Key
        </button>
      </form>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2 pr-3 font-medium">Cliente</th>
              <th className="py-2 pr-3 font-medium">Rol</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              <th className="py-2 pr-3 font-medium">Último uso</th>
              <th className="py-2 font-medium text-right">Revocar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {apiKeys.map((k) => (
              <tr key={k.keyHash}>
                <td className="py-2 pr-3 font-medium text-white">
                  {k.clientName}
                </td>
                <td className="py-2 pr-3">{formatRoleLabel(k.role)}</td>
                <td className="py-2 pr-3">
                  {k.active ? "Activa" : "Revocada"}
                </td>
                <td className="py-2 pr-3 text-slate-400">
                  {formatDateTime(k.lastUsed)}
                </td>
                <td className="py-2 text-right">
                  {k.active && (
                    <button
                      type="button"
                      onClick={() => void handleRevokeApiKey(k.keyHash)}
                      className="rounded-lg p-1.5 text-rose-400 hover:bg-slate-800"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

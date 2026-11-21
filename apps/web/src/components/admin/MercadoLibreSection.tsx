import { Link2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  MaskedMercadoLibreConfigDto,
  StockAgentApiClient,
  SyncMercadoLibreResponse,
} from "../../lib/api-client";
import type { AdminBanner } from "./types";

interface MercadoLibreSectionProps {
  api: StockAgentApiClient;
  refreshTick: number;
  onBanner: (banner: AdminBanner | null) => void;
}

export function MercadoLibreSection({
  api,
  refreshTick,
  onBanner,
}: MercadoLibreSectionProps) {
  const [mlConfig, setMlConfig] =
    useState<MaskedMercadoLibreConfigDto | null>(null);
  const [mlSyncRes, setMlSyncRes] = useState<SyncMercadoLibreResponse | null>(
    null
  );
  const [mlAppId, setMlAppId] = useState("");
  const [mlSecret, setMlSecret] = useState("");
  const [mlActivo, setMlActivo] = useState(false);
  const [mlHorasAtras, setMlHorasAtras] = useState("48");
  const [mlOAuthUrl, setMlOAuthUrl] = useState<string | null>(null);
  const [mlOAuthCode, setMlOAuthCode] = useState("");
  const [mlRedirectUri, setMlRedirectUri] = useState(() =>
    typeof window !== "undefined"
      ? `${window.location.origin}/oauth/mercadolibre/callback`
      : "https://localhost/oauth/mercadolibre/callback"
  );
  const [busy, setBusy] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.getMercadoLibreConfig();
      setMlConfig(res.config);
      setMlAppId(res.config.appId);
      setMlActivo(res.config.activo);
      setMlHorasAtras(String(res.config.horasAtras || 48));
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "Error cargando configuración de Mercado Libre.",
      });
    }
  }, [api, onBanner]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig, refreshTick]);

  async function handleSaveMlConfig(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onBanner(null);
    try {
      const res = await api.updateMercadoLibreConfig({
        appId: mlAppId.trim(),
        ...(mlSecret.trim() ? { clientSecret: mlSecret.trim() } : {}),
        activo: mlActivo,
        horasAtras: Math.max(1, Math.trunc(Number(mlHorasAtras) || 48)),
      });
      setMlConfig(res.config);
      setMlSecret("");
      onBanner({
        type: "ok",
        text: "Configuración Mercado Libre cifrada con AES-256-GCM en tenant_settings.",
      });
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "Error guardando Mercado Libre.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateMlOAuth() {
    onBanner(null);
    try {
      const res = await api.getMercadoLibreOAuthUrl(
        mlRedirectUri.trim(),
        "stockagent-web"
      );
      setMlOAuthUrl(res.url);
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error ? err.message : "Error generando URL OAuth.",
      });
    }
  }

  async function handleExchangeMlCode() {
    if (!mlOAuthCode.trim()) return;
    setBusy(true);
    try {
      const res = await api.submitMercadoLibreOAuthCallback(
        mlOAuthCode.trim(),
        mlRedirectUri.trim()
      );
      setMlOAuthCode("");
      onBanner({
        type: "ok",
        text: `Token OAuth vinculado al Seller ID ${res.sellerId}.`,
      });
      await loadConfig();
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error ? err.message : "Fallo al canjear code OAuth.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyMl() {
    setBusy(true);
    try {
      const res = await api.verifyMercadoLibre();
      onBanner({
        type: "ok",
        text: `Conexión verificada con vendedor ${res.nickname || res.sellerId || "Mercado Libre"}.`,
      });
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "Error verificando conexión ML.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncMl(simulateOnly: boolean) {
    setBusy(true);
    onBanner(null);
    try {
      const res = await api.syncMercadoLibreOrders(simulateOnly);
      setMlSyncRes(res);
      onBanner({
        type: "ok",
        text: simulateOnly
          ? `Simulación ML: ${res.mappedOrders.length} orden(es) mapeada(s), ${res.skippedAlreadyProcessed.length} omitida(s).`
          : `Sincronización confirmada: ${res.confirmResult?.totalUnidadesAplicadas ?? 0} unidades descontadas.`,
      });
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "Error sincronizando órdenes ML.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleSaveMlConfig}
        className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">
            Credenciales OAuth2 Mercado Libre
          </h3>
          {mlConfig && (
            <div className="flex gap-2 text-[11px]">
              <span className="rounded-lg bg-slate-800 px-2 py-0.5 text-slate-300">
                Secret: {mlConfig.hasClientSecret ? "Cifrado ✓" : "Falta"}
              </span>
              <span className="rounded-lg bg-slate-800 px-2 py-0.5 text-slate-300">
                Token: {mlConfig.hasAccessToken ? "Vinculado ✓" : "Sin vincular"}
              </span>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <input
            type="text"
            placeholder="APP ID"
            value={mlAppId}
            onChange={(e) => setMlAppId(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
          />
          <input
            type="password"
            placeholder={
              mlConfig?.hasClientSecret
                ? "Client Secret (dejar vacío para conservar)"
                : "Client Secret"
            }
            value={mlSecret}
            onChange={(e) => setMlSecret(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
          />
          <input
            type="number"
            placeholder="Horas hacia atrás"
            value={mlHorasAtras}
            onChange={(e) => setMlHorasAtras(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
          />
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={mlActivo}
            onChange={(e) => setMlActivo(e.target.checked)}
            className="rounded border-slate-600 bg-slate-950 text-sky-500"
          />
          Integración Mercado Libre habilitada para este tenant
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            Guardar Configuración
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleVerifyMl()}
            className="rounded-xl border border-slate-700 px-3.5 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            Verificar Token
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSyncMl(true)}
            className="rounded-xl border border-sky-500/40 bg-sky-500/15 px-3.5 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
          >
            Simular Órdenes
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSyncMl(false)}
            className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Sincronizar y Descontar
          </button>
        </div>
      </form>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3 text-xs">
        <h4 className="font-semibold text-white">Vinculación OAuth2</h4>
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            value={mlRedirectUri}
            onChange={(e) => setMlRedirectUri(e.target.value)}
            className="flex-1 min-w-[240px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
          <button
            type="button"
            onClick={() => void handleGenerateMlOAuth()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800"
          >
            <Link2 className="h-3.5 w-3.5" />
            Generar URL OAuth
          </button>
        </div>
        {mlOAuthUrl && (
          <p className="break-all rounded-xl bg-slate-950 p-2.5 font-mono text-[11px] text-sky-300">
            {mlOAuthUrl}
          </p>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={mlOAuthCode}
            onChange={(e) => setMlOAuthCode(e.target.value)}
            placeholder="Pegar parámetro ?code=TG-... recibido"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
          <button
            type="button"
            disabled={busy || !mlOAuthCode.trim()}
            onClick={() => void handleExchangeMlCode()}
            className="rounded-xl bg-sky-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-40"
          >
            Vincular Code
          </button>
        </div>
      </div>

      {mlSyncRes && (
        <div className="rounded-2xl border border-sky-500/30 bg-slate-900/80 p-4 text-xs space-y-2">
          <p className="font-semibold text-white">
            Resultado {mlSyncRes.simulateOnly ? "(Simulación)" : "(Aplicado)"}:{" "}
            {mlSyncRes.mappedOrders.length} mapeadas ·{" "}
            {mlSyncRes.skippedAlreadyProcessed.length} omitidas por duplicado
          </p>
          {mlSyncRes.mappedOrders.map((ord) => (
            <div
              key={ord.ordenId}
              className="rounded-xl border border-slate-800 bg-slate-950 p-2.5"
            >
              <span className="font-mono text-sky-300">{ord.refPedido}</span> —{" "}
              {ord.cliente} ({ord.totalUnidades} u.)
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

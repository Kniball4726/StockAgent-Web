import {
  CheckCircle2,
  DatabaseBackup,
  KeyRound,
  Link2,
  RefreshCw,
  ScrollText,
  ShoppingBag,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserRole, UsuarioResponse } from "@stockagent/shared";
import type {
  AuditLogRow,
  MaskedMercadoLibreConfigDto,
  SafeUserRow,
  StockAgentApiClient,
  SyncMercadoLibreResponse,
  TenantApiKeyRow,
} from "../lib/api-client";
import { formatBytes, formatDateTime, formatRoleLabel } from "../lib/rbac";

interface AdminIntegrationsTabProps {
  api: StockAgentApiClient;
  user: UsuarioResponse;
}

type AdminSubTab = "users" | "mercadolibre" | "apikeys" | "audit" | "saas";

export function AdminIntegrationsTab({ api, user }: AdminIntegrationsTabProps) {
  const [subTab, setSubTab] = useState<AdminSubTab>("users");
  const isMaster = user.role === "master";

  const [usersList, setUsersList] = useState<SafeUserRow[]>([]);
  const [apiKeys, setApiKeys] = useState<TenantApiKeyRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [mlConfig, setMlConfig] = useState<MaskedMercadoLibreConfigDto | null>(
    null
  );
  const [mlSyncRes, setMlSyncRes] = useState<SyncMercadoLibreResponse | null>(
    null
  );

  // Form usuario
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("operador");
  const [newNombre, setNewNombre] = useState("");

  // Form API Key
  const [keyClientName, setKeyClientName] = useState("");
  const [keyRole, setKeyRole] = useState<UserRole>("consulta");
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);

  // Form Mercado Libre
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
  const [banner, setBanner] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );
  const [saasUsage, setSaasUsage] = useState<{
    tenant: { id: string; slug: string; name: string; plan: string; active: boolean };
    quotas: { maxUsers: number; maxProducts: number; maxStorageBytes: number };
    usage: { usersCount: number; productsCount: number; storageBytes: number };
    withinLimits: boolean;
  } | null>(null);
  const [lastBackupMeta, setLastBackupMeta] = useState<{
    sha256Checksum: string;
    exportedAt: string;
    counts: Record<string, number>;
  } | null>(null);

  const loadData = useCallback(async () => {
    setBanner(null);
    try {
      if (subTab === "users") {
        const res = await api.listUsers();
        setUsersList(res.users);
      } else if (subTab === "apikeys" && isMaster) {
        const res = await api.listApiKeys();
        setApiKeys(res.api_keys);
      } else if (subTab === "audit") {
        const res = await api.listAuditLogs(80);
        setAuditLogs(res.logs);
      } else if (subTab === "saas") {
        const res = await api.getSaasUsage();
        setSaasUsage(res);
      } else if (subTab === "mercadolibre") {
        const res = await api.getMercadoLibreConfig();
        setMlConfig(res.config);
        setMlAppId(res.config.appId);
        setMlActivo(res.config.activo);
        setMlHorasAtras(String(res.config.horasAtras || 48));
      }
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error cargando datos de administración.",
      });
    }
  }, [api, isMaster, subTab]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
        nombre: newNombre.trim() || newUsername.trim(),
        email: "",
        must_change_password: false,
      });
      setNewUsername("");
      setNewPassword("");
      setNewNombre("");
      setBanner({ type: "ok", text: "Usuario creado correctamente en el tenant." });
      await loadData();
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "No se pudo crear el usuario.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleUserActive(target: SafeUserRow) {
    try {
      await api.updateUser(target.id, { active: !target.active });
      await loadData();
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "No se pudo actualizar usuario.",
      });
    }
  }

  async function handleCreateApiKey(e: FormEvent) {
    e.preventDefault();
    if (!keyClientName.trim()) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await api.createApiKey({
        client_name: keyClientName.trim(),
        role: keyRole,
      });
      setGeneratedRawKey(res.api_key);
      setKeyClientName("");
      await loadData();
    } catch (err) {
      setBanner({
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
      await loadData();
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "No se pudo revocar la API Key.",
      });
    }
  }

  async function handleSaveMlConfig(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      const res = await api.updateMercadoLibreConfig({
        appId: mlAppId.trim(),
        ...(mlSecret.trim() ? { clientSecret: mlSecret.trim() } : {}),
        activo: mlActivo,
        horasAtras: Math.max(1, Math.trunc(Number(mlHorasAtras) || 48)),
      });
      setMlConfig(res.config);
      setMlSecret("");
      setBanner({
        type: "ok",
        text: "Configuración Mercado Libre cifrada con AES-256-GCM en tenant_settings.",
      });
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error guardando Mercado Libre.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateMlOAuth() {
    setBanner(null);
    try {
      const res = await api.getMercadoLibreOAuthUrl(mlRedirectUri.trim(), "stockagent-web");
      setMlOAuthUrl(res.url);
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error generando URL OAuth.",
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
      setBanner({
        type: "ok",
        text: `Token OAuth vinculado al Seller ID ${res.sellerId}.`,
      });
      await loadData();
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Fallo al canjear code OAuth.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyMl() {
    setBusy(true);
    try {
      const res = await api.verifyMercadoLibre();
      setBanner({
        type: "ok",
        text: `Conexión verificada con vendedor ${res.nickname || res.sellerId || "Mercado Libre"}.`,
      });
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error verificando conexión ML.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncMl(simulateOnly: boolean) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await api.syncMercadoLibreOrders(simulateOnly);
      setMlSyncRes(res);
      setBanner({
        type: "ok",
        text: simulateOnly
          ? `Simulación ML: ${res.mappedOrders.length} orden(es) mapeada(s), ${res.skippedAlreadyProcessed.length} omitida(s).`
          : `Sincronización confirmada: ${res.confirmResult?.totalUnidadesAplicadas ?? 0} unidades descontadas.`,
      });
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error sincronizando órdenes ML.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleExportTenantBackup() {
    setBusy(true);
    setBanner(null);
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

      setBanner({
        type: "ok",
        text: `Backup SHA-256 exportado (${snapshot.sha256Checksum.slice(0, 16)}...).`,
      });
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "No se pudo exportar el backup.",
      });
    } finally {
      setBusy(false);
    }
  }

  const allowedCreatableRoles: UserRole[] = isMaster
    ? ["operador", "picker", "consulta", "administrador", "master"]
    : ["operador", "picker", "consulta"];

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
          onClick={() => void loadData()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Recargar
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSubTab("users")}
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
          onClick={() => setSubTab("mercadolibre")}
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
            onClick={() => setSubTab("apikeys")}
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
          onClick={() => setSubTab("audit")}
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
          onClick={() => setSubTab("saas")}
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
        <div className="space-y-5">
          <form
            onSubmit={handleCreateUser}
            className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
                <UserPlus className="h-4 w-4 text-sky-400" />
                Crear Usuario en el Tenant
              </h3>
              {!isMaster && (
                <span className="text-[11px] text-amber-300">
                  SoD: Solo el rol Master puede crear Administradores/Masters
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <input
                type="text"
                placeholder="Usuario *"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
              <input
                type="text"
                placeholder="Nombre completo"
                value={newNombre}
                onChange={(e) => setNewNombre(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
              <input
                type="password"
                placeholder="Contraseña (min 10) *"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={10}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              >
                {allowedCreatableRoles.map((r) => (
                  <option key={r} value={r}>
                    {formatRoleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              Crear Usuario
            </button>
          </form>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3 font-medium">Usuario</th>
                  <th className="py-2 pr-3 font-medium">Nombre</th>
                  <th className="py-2 pr-3 font-medium">Rol</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 font-medium text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {usersList.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2 pr-3 font-mono text-sky-300">{u.username}</td>
                    <td className="py-2 pr-3 text-slate-200">{u.nombre || "—"}</td>
                    <td className="py-2 pr-3">{formatRoleLabel(u.role)}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          u.active
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-slate-700 text-slate-300"
                        }`}
                      >
                        {u.active ? "ACTIVO" : "INACTIVO"}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void handleToggleUserActive(u)}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                      >
                        {u.active ? "Desactivar" : "Reactivar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === "mercadolibre" && (
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
      )}

      {subTab === "apikeys" && isMaster && (
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
                    <td className="py-2 pr-3 font-medium text-white">{k.clientName}</td>
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
      )}

      {subTab === "audit" && (
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
                  <td className="py-2 pr-3 font-mono text-slate-200">{log.accion}</td>
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
      )}

      {subTab === "saas" && (
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
                    · Estado: {saasUsage.withinLimits ? "Dentro de cuota" : "Cuota excedida"}
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
                    Exporta catálogo, pedidos, movimientos, auditoría y metadatos aislados del tenant.
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
                  SHA-256: {lastBackupMeta.sha256Checksum} · {formatDateTime(lastBackupMeta.exportedAt)}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
              Solo usuarios con rol <strong>Master</strong> pueden exportar snapshots completos de respaldo.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import {
  AlertCircle,
  Boxes,
  Building2,
  CheckCircle2,
  KeyRound,
  Lock,
  Server,
  User,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { UsuarioResponse } from "@stockagent/shared";
import {
  ApiClientError,
  getSavedApiBaseUrlOverride,
  saveApiBaseUrlOverride,
  type StockAgentApiClient,
} from "../lib/api-client";

interface LoginViewProps {
  api: StockAgentApiClient;
  pendingPasswordChangeUser: UsuarioResponse | null;
  onLoginSuccess: (token: string, user: UsuarioResponse) => void;
  onPasswordChanged: () => void;
  onLogout: () => void;
}

export function LoginView({
  api,
  pendingPasswordChangeUser,
  onLoginSuccess,
  onPasswordChanged,
  onLogout,
}: LoginViewProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => getSavedApiBaseUrlOverride());
  const [pingStatus, setPingStatus] = useState<string | null>(null);

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Ingresá usuario y contraseña.");
      return;
    }

    setSubmitting(true);
    try {
      const normalizedServer = saveApiBaseUrlOverride(serverUrl);
      api.setBaseUrl(normalizedServer);

      const res = await api.login({
        username: username.trim(),
        password,
        ...(tenantSlug.trim() ? { tenantSlug: tenantSlug.trim().toLowerCase() } : {}),
      });

      if (!res.ok || !res.token || !res.user) {
        setError(res.message || "Credenciales inválidas.");
        return;
      }

      onLoginSuccess(res.token, res.user);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError("No se pudo iniciar sesión contra el servidor.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestPing() {
    setPingStatus(null);
    setError(null);
    try {
      const normalized = saveApiBaseUrlOverride(serverUrl);
      api.setBaseUrl(normalized);
      const ping = await api.ping();
      setPingStatus(`Servidor activo (${ping.status}) — ${new Date(ping.timestamp).toLocaleTimeString("es-AR")}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo contactar al servidor API."
      );
    }
  }

  async function handleForcePasswordChange(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPwd.length < 10) {
      setError("La nueva contraseña debe tener al menos 10 caracteres.");
      return;
    }
    if (newPwd !== confirmPwd) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(currentPwd, newPwd);
      onPasswordChanged();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "No se pudo actualizar la contraseña."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl backdrop-blur">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
            <Boxes className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              StockAgent Web
            </h1>
            <p className="text-xs text-slate-400">
              Plataforma multi-tenant de inventario, remitos y despacho
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {pingStatus && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{pingStatus}</span>
          </div>
        )}

        {pendingPasswordChangeUser ? (
          <form onSubmit={handleForcePasswordChange} className="space-y-4">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Hola <strong>{pendingPasswordChangeUser.username}</strong>, tu cuenta requiere actualizar la contraseña antes de operar (mínimo 10 caracteres).
            </div>

            <div>
              <label
                htmlFor="current-password"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Contraseña actual
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="new-password"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Nueva contraseña
              </label>
              <input
                id="new-password"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                required
                minLength={10}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Repetir nueva contraseña
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                required
                minLength={10}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onLogout}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                <KeyRound className="h-4 w-4" />
                {submitting ? "Guardando..." : "Actualizar y Entrar"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="login-tenant"
                className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300"
              >
                <Building2 className="h-3.5 w-3.5 text-slate-400" />
                Organización / Tenant (opcional)
              </label>
              <input
                id="login-tenant"
                type="text"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="default"
                autoComplete="organization"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="login-username"
                className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300"
              >
                <User className="h-3.5 w-3.5 text-slate-400" />
                Usuario o Email
              </label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ej: Auditoria"
                autoComplete="username"
                required
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300"
              >
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                Contraseña
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                autoComplete="current-password"
                required
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
            >
              {submitting ? "Ingresando..." : "Iniciar Sesión"}
            </button>

            <div className="pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setShowServerConfig((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
              >
                <Server className="h-3.5 w-3.5" />
                {showServerConfig
                  ? "Ocultar configuración del servidor"
                  : "Configurar URL del servidor API"}
              </button>

              {showServerConfig && (
                <div className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <label
                    htmlFor="api-server-url"
                    className="block text-[11px] font-medium text-slate-400"
                  >
                    URL Base (vacío = mismo origen / proxy Vite)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="api-server-url"
                      type="url"
                      value={serverUrl}
                      onChange={(e) => setServerUrl(e.target.value)}
                      placeholder="http://127.0.0.1:3000"
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleTestPing}
                      className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      Probar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { UsuarioResponse } from "@stockagent/shared";
import { ApiClientError, type StockAgentApiClient } from "../../lib/api-client";

interface ForcePasswordChangeFormProps {
  api: StockAgentApiClient;
  user: UsuarioResponse;
  onPasswordChanged: () => void;
  onLogout: () => void;
  onError: (message: string | null) => void;
}

export function ForcePasswordChangeForm({
  api,
  user,
  onPasswordChanged,
  onLogout,
  onError,
}: ForcePasswordChangeFormProps) {
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onError(null);
    if (newPwd.length < 10) {
      onError("La nueva contraseña debe tener al menos 10 caracteres.");
      return;
    }
    if (newPwd !== confirmPwd) {
      onError("Las contraseñas nuevas no coinciden.");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(currentPwd, newPwd);
      onPasswordChanged();
    } catch (err) {
      onError(
        err instanceof ApiClientError
          ? err.message
          : "No se pudo actualizar la contraseña."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
        Hola <strong>{user.username}</strong>, tu cuenta requiere actualizar la
        contraseña antes de operar (mínimo 10 caracteres).
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
  );
}

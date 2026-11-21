import { UserPlus } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserRole } from "@stockagent/shared";
import type { SafeUserRow, StockAgentApiClient } from "../../lib/api-client";
import { formatRoleLabel } from "../../lib/rbac";
import type { AdminBanner } from "./types";

interface UsersAdminSectionProps {
  api: StockAgentApiClient;
  isMaster: boolean;
  refreshTick: number;
  onBanner: (banner: AdminBanner | null) => void;
}

export function UsersAdminSection({
  api,
  isMaster,
  refreshTick,
  onBanner,
}: UsersAdminSectionProps) {
  const [usersList, setUsersList] = useState<SafeUserRow[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("operador");
  const [newNombre, setNewNombre] = useState("");
  const [busy, setBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const res = await api.listUsers();
      setUsersList(res.users);
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "Error cargando usuarios del tenant.",
      });
    }
  }, [api, onBanner]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers, refreshTick]);

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onBanner(null);
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
      onBanner({
        type: "ok",
        text: "Usuario creado correctamente en el tenant.",
      });
      await loadUsers();
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error ? err.message : "No se pudo crear el usuario.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleUserActive(target: SafeUserRow) {
    try {
      await api.updateUser(target.id, { active: !target.active });
      await loadUsers();
    } catch (err) {
      onBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "No se pudo actualizar usuario.",
      });
    }
  }

  const allowedCreatableRoles: UserRole[] = isMaster
    ? ["operador", "picker", "consulta", "administrador", "master"]
    : ["operador", "picker", "consulta"];

  return (
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
  );
}

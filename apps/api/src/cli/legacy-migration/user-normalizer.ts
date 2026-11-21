import { USER_ROLES, type UserRole } from "@stockagent/shared";
import type { LegacyUserSeed } from "./types.js";

export function normalizeLegacyUsers(rawList: unknown): {
  users: LegacyUserSeed[];
  warnings: string[];
} {
  if (!Array.isArray(rawList)) {
    return { users: [], warnings: ["El JSON de usuarios no es un arreglo."] };
  }

  const validRoles = new Set<string>(USER_ROLES);
  const parsed: LegacyUserSeed[] = [];
  const warnings: string[] = [];

  for (const entry of rawList) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const username = String(rec.username ?? "").trim();
    const passwordHash = String(
      rec.passwordHash ?? rec.password_hash ?? ""
    ).trim();
    const rawRole = String(rec.role ?? "operador").trim().toLowerCase();
    const role: UserRole = validRoles.has(rawRole)
      ? (rawRole as UserRole)
      : "operador";

    if (!username || !passwordHash) {
      warnings.push(`Usuario omitido por falta de username/hash: ${username || "?"}`);
      continue;
    }

    parsed.push({
      username,
      passwordHash,
      role,
      nombre: String(rec.nombre ?? username).trim(),
      email: String(rec.email ?? "").trim(),
      active: rec.active !== false && rec.active !== 0,
    });
  }

  return { users: parsed, warnings };
}

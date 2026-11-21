import type { UserRole } from "@stockagent/shared";

export interface LegacyProductSeed {
  code: string;
  name: string;
  stock: number;
  stockMinimo: number;
  stockMaximo: number;
  codBarras: string;
  ubicacion: string;
}

export interface LegacyUserSeed {
  username: string;
  passwordHash: string;
  role: UserRole;
  nombre: string;
  email: string;
  active: boolean;
}

export interface LegacyMigrationReport {
  tenantSlug: string;
  dryRun: boolean;
  productsParsed: number;
  productsInserted: number;
  productsUpdated: number;
  usersParsed: number;
  usersInserted: number;
  usersSkipped: number;
  warnings: string[];
}

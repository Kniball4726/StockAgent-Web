import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizarCodigo,
  USER_ROLES,
  type UserRole,
} from "@stockagent/shared";
import { eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { loadEnvFileIfPresent } from "../config/env.js";
import { createDbConnection, withTenantTransaction, type Database } from "../db/client.js";
import {
  auditLogs,
  products,
  tenants,
  users,
} from "../db/schema/index.js";

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

function normalizeHeaderName(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function toIntOrDefault(raw: unknown, fallback: number): number {
  const num = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : fallback;
}

/**
 * Parsea un archivo heredado `Productos.xlsx` para migración ÚNICA inicial hacia PostgreSQL.
 * No sincroniza ni reescribe Excel en tiempo de ejecución.
 */
export async function parseLegacyCatalogXlsx(
  buffer: Buffer
): Promise<{ items: LegacyProductSeed[]; warnings: string[] }> {
  const wb = new ExcelJS.Workbook();
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  await wb.xlsx.load(ab as ArrayBuffer);

  const sheet = wb.worksheets[0];
  if (!sheet) {
    return { items: [], warnings: ["El libro Excel no contiene hojas."] };
  }

  let headerRowIdx = -1;
  let colMap: Record<string, number> = {};

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headerRowIdx !== -1) return;
    const candidateMap: Record<string, number> = {};
    row.eachCell((cell, colNumber) => {
      const h = normalizeHeaderName(cell.text ?? cell.value);
      if (h) {
        candidateMap[h] = colNumber;
      }
    });
    const keys = Object.keys(candidateMap);
    const hasCode = keys.some(
      (k) =>
        k === "codigo" ||
        k === "sku" ||
        k === "cod" ||
        k === "code" ||
        k.includes("articulo")
    );
    const hasStock = keys.some((k) => k.includes("stock"));
    if (hasCode && hasStock) {
      headerRowIdx = rowNumber;
      colMap = candidateMap;
    }
  });

  if (headerRowIdx === -1) {
    return {
      items: [],
      warnings: ["No se detectó fila de encabezados (código/stock) en Productos.xlsx."],
    };
  }

  const findCol = (predicates: string[]): number | undefined => {
    for (const [header, col] of Object.entries(colMap)) {
      if (predicates.some((p) => header === p || header.includes(p))) {
        return col;
      }
    }
    return undefined;
  };

  const codeCol = findCol(["codigo", "sku", "cod", "code", "articulo"]);
  const nameCol = findCol(["descripcion", "producto", "nombre", "name", "detalle"]);
  const stockCol = findCol(["stock", "cantidad", "saldo"]);
  const minCol = findCol(["minimo", "min", "alerta"]);
  const maxCol = findCol(["maximo", "max"]);
  const barcodeCol = findCol(["barra", "ean", "barcode", "upc"]);
  const locCol = findCol(["ubicacion", "estanteria", "pasillo", "location"]);

  const items: LegacyProductSeed[] = [];
  const warnings: string[] = [];
  const seenCodes = new Set<string>();

  for (let r = headerRowIdx + 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const rawCode = codeCol ? row.getCell(codeCol).text || row.getCell(codeCol).value : "";
    const code = normalizarCodigo(rawCode);
    if (!code) continue;

    if (seenCodes.has(code.toLowerCase())) {
      warnings.push(`Fila ${r}: código duplicado '${code}' omitido.`);
      continue;
    }
    seenCodes.add(code.toLowerCase());

    const rawName = nameCol ? row.getCell(nameCol).text || row.getCell(nameCol).value : "";
    const rawStock = stockCol ? row.getCell(stockCol).value : 0;
    const rawMin = minCol ? row.getCell(minCol).value : 5;
    const rawMax = maxCol ? row.getCell(maxCol).value : 100;
    const rawBarcode = barcodeCol
      ? row.getCell(barcodeCol).text || row.getCell(barcodeCol).value
      : "";
    const rawLoc = locCol
      ? row.getCell(locCol).text || row.getCell(locCol).value
      : "";

    items.push({
      code,
      name: String(rawName ?? "").trim() || `Producto ${code}`,
      stock: toIntOrDefault(rawStock, 0),
      stockMinimo: toIntOrDefault(rawMin, 5),
      stockMaximo: Math.max(
        toIntOrDefault(rawMin, 5),
        toIntOrDefault(rawMax, 100)
      ),
      codBarras: String(rawBarcode ?? "").trim(),
      ubicacion: String(rawLoc ?? "").trim().toUpperCase(),
    });
  }

  return { items, warnings };
}

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

export async function importLegacyDatasetToTenant(params: {
  db: Database;
  tenantSlug: string;
  products: LegacyProductSeed[];
  users?: LegacyUserSeed[];
  dryRun?: boolean;
  overwriteExistingStock?: boolean;
  initialWarnings?: string[];
}): Promise<LegacyMigrationReport> {
  const dryRun = params.dryRun ?? true;
  const legacyUsers = params.users ?? [];
  const warnings = [...(params.initialWarnings ?? [])];

  const [tenant] = await params.db
    .select()
    .from(tenants)
    .where(sql`lower(${tenants.slug}) = lower(${params.tenantSlug})`)
    .limit(1);

  if (!tenant) {
    throw new Error(`Tenant '${params.tenantSlug}' no encontrado.`);
  }

  let productsInserted = 0;
  let productsUpdated = 0;
  let usersInserted = 0;
  let usersSkipped = 0;

  await withTenantTransaction(
    params.db,
    tenant.id,
    async (tx, validTenantId) => {
      const existingProductsRows = await tx
        .select({ id: products.id, code: products.code })
        .from(products)
        .where(eq(products.tenantId, validTenantId));
      const productByCodeLower = new Map<string, number>();
      for (const row of existingProductsRows) {
        productByCodeLower.set(row.code.toLowerCase(), row.id);
      }

      for (const item of params.products) {
        const existingId = productByCodeLower.get(item.code.toLowerCase());
        if (existingId === undefined) {
          productsInserted += 1;
          if (!dryRun) {
            await tx.insert(products).values({
              tenantId: validTenantId,
              code: item.code,
              name: item.name,
              stock: item.stock,
              stockFisico: item.stock,
              stockMinimo: item.stockMinimo,
              stockMaximo: item.stockMaximo,
              codBarras: item.codBarras,
              ubicacion: item.ubicacion,
              active: true,
            });
          }
          productByCodeLower.set(item.code.toLowerCase(), -1);
        } else if (params.overwriteExistingStock && existingId > 0) {
          productsUpdated += 1;
          if (!dryRun) {
            await tx
              .update(products)
              .set({
                name: item.name,
                stock: item.stock,
                stockFisico: item.stock,
                stockMinimo: item.stockMinimo,
                stockMaximo: item.stockMaximo,
                ...(item.codBarras ? { codBarras: item.codBarras } : {}),
                ...(item.ubicacion ? { ubicacion: item.ubicacion } : {}),
                updatedAt: new Date(),
              })
              .where(eq(products.id, existingId));
          }
        }
      }

      const existingUserRows = await tx
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.tenantId, validTenantId));
      const existingUsernamesLower = new Set<string>(
        existingUserRows.map((u) => u.username.toLowerCase())
      );

      for (const usr of legacyUsers) {
        if (existingUsernamesLower.has(usr.username.toLowerCase())) {
          usersSkipped += 1;
          continue;
        }

        usersInserted += 1;
        existingUsernamesLower.add(usr.username.toLowerCase());
        if (!dryRun) {
          await tx.insert(users).values({
            tenantId: validTenantId,
            username: usr.username,
            passwordHash: usr.passwordHash,
            role: usr.role,
            active: usr.active,
            mustChangePassword: false,
            nombre: usr.nombre,
            email: usr.email,
          });
        }
      }

      if (!dryRun) {
        await tx.insert(auditLogs).values({
          tenantId: validTenantId,
          usuario: "cli:migrate-legacy",
          accion: "LEGACY_MIGRATION_IMPORT",
          detalle: `Productos +${productsInserted}/upd=${productsUpdated}, Usuarios +${usersInserted}/skip=${usersSkipped}`,
        });
      }
    }
  );

  return {
    tenantSlug: tenant.slug,
    dryRun,
    productsParsed: params.products.length,
    productsInserted,
    productsUpdated,
    usersParsed: legacyUsers.length,
    usersInserted,
    usersSkipped,
    warnings,
  };
}

function parseFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }
  return undefined;
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  loadEnvFileIfPresent();
  const argv = process.argv.slice(2);
  const excelPath = parseFlag(argv, "--excel");
  const usersJsonPath = parseFlag(argv, "--users-json");
  const tenantSlug = parseFlag(argv, "--tenant") ?? "default";
  const apply = argv.includes("--apply");
  const overwriteStock = argv.includes("--overwrite-stock");

  if (!excelPath && !usersJsonPath) {
    console.error(
      "Uso: migrate-legacy --tenant <slug> [--excel Productos.xlsx] [--users-json users.json] [--apply]"
    );
    process.exit(1);
  }

  let prodItems: LegacyProductSeed[] = [];
  const allWarnings: string[] = [];

  if (excelPath) {
    const xlsxBuf = await readFile(resolve(excelPath));
    const parsedXlsx = await parseLegacyCatalogXlsx(xlsxBuf);
    prodItems = parsedXlsx.items;
    allWarnings.push(...parsedXlsx.warnings);
  }

  let legacyUsers: LegacyUserSeed[] = [];
  if (usersJsonPath) {
    const rawJson = JSON.parse(await readFile(resolve(usersJsonPath), "utf8"));
    const parsedUsers = normalizeLegacyUsers(rawJson);
    legacyUsers = parsedUsers.users;
    allWarnings.push(...parsedUsers.warnings);
  }

  const { pool, db } = createDbConnection();
  try {
    const report = await importLegacyDatasetToTenant({
      db,
      tenantSlug,
      products: prodItems,
      users: legacyUsers,
      dryRun: !apply,
      overwriteExistingStock: overwriteStock,
      initialWarnings: allWarnings,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

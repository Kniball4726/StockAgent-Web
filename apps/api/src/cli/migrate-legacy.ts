import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFileIfPresent } from "../config/env.js";
import { createDbConnection } from "../db/client.js";
import { importLegacyDatasetToTenant } from "./legacy-migration/dataset-importer.js";
import { parseLegacyCatalogXlsx } from "./legacy-migration/excel-parser.js";
import type { LegacyProductSeed, LegacyUserSeed } from "./legacy-migration/types.js";
import { normalizeLegacyUsers } from "./legacy-migration/user-normalizer.js";

// Re-export public types and functions for backward compatibility
export * from "./legacy-migration/types.js";
export * from "./legacy-migration/excel-parser.js";
export * from "./legacy-migration/user-normalizer.js";
export * from "./legacy-migration/dataset-importer.js";

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

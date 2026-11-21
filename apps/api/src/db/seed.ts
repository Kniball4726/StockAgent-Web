import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { loadEnvFileIfPresent } from "../config/env.js";
import { hashPassword } from "../security/crypto.js";
import { createDbConnection, withTenantTransaction, type Database } from "./client.js";
import { customers, products, tenantSettings, tenants, users } from "./schema/index.js";

export interface SeedResult {
  defaultTenantId: string;
  masterUsername: string;
  qaTenantId?: string | undefined;
}

const QA_PRODUCTS: Array<[string, string, number, string, string]> = [
  ["101", "Proteína Whey 1kg Vainilla", 150, "7791234567890", "ESTANTE-A1"],
  ["102", "Proteína Whey 1kg Chocolate", 120, "7791234567891", "ESTANTE-A2"],
  ["201", "Creatina Monohidrato 300g", 80, "7791234567892", "ESTANTE-B1"],
  ["202", "Creatina Micronizada 500g", 50, "7791234567893", "ESTANTE-B2"],
  ["301", "BCAA 2:1:1 250g Frutos Rojos", 95, "7791234567894", "ESTANTE-C1"],
  ["302", "Shaker Mezclador 700ml Negro", 200, "7791234567895", "ESTANTE-D1"],
  ["401", "Barra Proteica Choco-Caramelo", 300, "7791234567896", "ESTANTE-E1"],
];

const QA_USERS: Array<[string, string, "administrador" | "picker" | "operador" | "consulta", string, string]> = [
  ["admin_qa", "password123", "administrador", "Admin QA", "admin.qa@empresa.com"],
  ["picker_qa", "password123", "picker", "Picker QA", "picker.qa@empresa.com"],
  ["operador_qa", "password123", "operador", "Operador QA", "operador.qa@empresa.com"],
  ["consulta_qa", "password123", "consulta", "Consulta QA", "consulta.qa@empresa.com"],
];

const QA_CUSTOMERS: Array<[string, string, string]> = [
  ["Distribuidora Fitness SA", "CLI-001", "Av. San Martín 1234"],
  ["Gimnasio MegaSport SRL", "CLI-002", "Calle Belgrano 456"],
  ["Mercado Libre", "ML-001", "Centro Logístico Colecta"],
  ["Mercado Envíos Full", "FULL-001", "Depósito Central Full"],
];

async function ensureTenant(
  db: Database,
  slug: string,
  name: string,
  plan: "free" | "pro" | "enterprise" = "enterprise"
): Promise<string> {
  const [existing] = await db
    .select()
    .from(tenants)
    .where(sql`lower(${tenants.slug}) = lower(${slug})`)
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await db
    .insert(tenants)
    .values({ slug, name, plan, active: true })
    .returning();

  if (!created) {
    throw new Error(`No se pudo crear el tenant '${slug}'.`);
  }

  await withTenantTransaction(db, created.id, async (tx, tenantId) => {
    await tx
      .insert(tenantSettings)
      .values({ tenantId })
      .onConflictDoNothing();
  });

  return created.id;
}

export async function seedDatabase(
  db: Database,
  options: { includeQa?: boolean } = {}
): Promise<SeedResult> {
  const defaultTenantId = await ensureTenant(
    db,
    "default",
    "Depósito Central",
    "enterprise"
  );

  const masterUsername = (process.env.STOCKAGENT_MASTER_USER ?? "Auditoria").trim();
  const masterPassword = process.env.STOCKAGENT_MASTER_PASSWORD ?? "master1713";
  const isDefaultMasterPass = masterPassword === "master1713";

  await withTenantTransaction(db, defaultTenantId, async (tx, tenantId) => {
    const [existingMaster] = await tx
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          sql`lower(${users.username}) = lower(${masterUsername})`
        )
      )
      .limit(1);

    if (!existingMaster) {
      await tx.insert(users).values({
        tenantId,
        username: masterUsername,
        passwordHash: hashPassword(masterPassword),
        role: "master",
        active: true,
        mustChangePassword: isDefaultMasterPass,
        nombre: "Auditoría",
        email: "",
      });
    }
  });

  let qaTenantId: string | undefined;
  if (options.includeQa) {
    qaTenantId = await ensureTenant(db, "qa", "Ambiente QA / Pruebas", "pro");
    await withTenantTransaction(db, qaTenantId, async (tx, tenantId) => {
      for (const [uName, uPass, uRole, uNom, uEmail] of QA_USERS) {
        const [exists] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.tenantId, tenantId),
              sql`lower(${users.username}) = lower(${uName})`
            )
          )
          .limit(1);
        if (!exists) {
          await tx.insert(users).values({
            tenantId,
            username: uName,
            passwordHash: hashPassword(uPass),
            role: uRole,
            active: true,
            mustChangePassword: false,
            nombre: uNom,
            email: uEmail,
          });
        }
      }

      for (let i = 0; i < QA_PRODUCTS.length; i += 1) {
        const row = QA_PRODUCTS[i];
        if (!row) continue;
        const [code, name, stock, codBarras, ubicacion] = row;
        await tx
          .insert(products)
          .values({
            tenantId,
            code,
            name,
            stock,
            stockMinimo: 5,
            stockMaximo: 150,
            codBarras,
            ubicacion,
            displayOrder: i + 1,
            active: true,
          })
          .onConflictDoNothing();
      }

      for (const [nombre, codigo, direccion] of QA_CUSTOMERS) {
        await tx
          .insert(customers)
          .values({ tenantId, nombre, codigo, direccion, activo: true })
          .onConflictDoNothing();
      }
    });
  }

  return { defaultTenantId, masterUsername, qaTenantId };
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  loadEnvFileIfPresent();
  const includeQa = process.argv.includes("--qa");
  const { pool, db } = createDbConnection();
  try {
    const result = await seedDatabase(db, { includeQa });
    console.log("[db:seed] Seed completado:", result);
  } finally {
    await pool.end();
  }
}

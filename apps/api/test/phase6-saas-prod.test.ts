import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it } from "vitest";
import { TENANT_PLAN_QUOTAS } from "@stockagent/shared";
import { createApp } from "../src/app.js";
import {
  readGzippedJson,
  writeGzippedJson,
} from "../src/cli/backup.js";
import {
  importLegacyDatasetToTenant,
  normalizeLegacyUsers,
  parseLegacyCatalogXlsx,
} from "../src/cli/migrate-legacy.js";
import { loadAppConfig } from "../src/config/env.js";
import type { Database } from "../src/db/client.js";
import {
  applyTenantRlsAndViews,
  TENANT_STRICT_RLS_TABLES,
} from "../src/db/rls.js";
import * as schema from "../src/db/schema/index.js";
import type { AuthResolver } from "../src/http/auth-context.js";
import { LOG_REDACTION_PATHS } from "../src/observability/metrics.js";
import type { TenantAuthRepository } from "../src/repositories/tenant-auth-repository.js";
import {
  createSignedTenantSnapshot,
  type TenantBackupService,
  verifyTenantSnapshotIntegrity,
} from "../src/saas/backup-service.js";
import type { TenantAdminService } from "../src/saas/tenant-admin-service.js";
import { verifyPassword } from "../src/security/crypto.js";
import {
  assertSafeExternalUrl,
  validateProductionSecurityConfig,
} from "../src/security/http-hardening.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const TENANT_DEFAULT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_B_ID = "22222222-2222-4222-8222-222222222222";

const PYTHON_LEGACY_HASH =
  "0123456789abcdef0123456789abcdef:8415454e8916779f8c058d90889a95a41aeaef72820a3e1ebf2593c701006920";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "stockagent-phase6-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("Fase 6 - Aislamiento Multi-Tenant, RLS y Controles SaaS", () => {
  it("todas las tablas del esquema Drizzle con tenant_id están cubiertas por políticas RLS", () => {
    const tablesWithTenant: string[] = [];
    for (const exported of Object.values(schema)) {
      if (!exported || typeof exported !== "object") continue;
      try {
        const cfg = getTableConfig(exported as never);
        const hasTenantCol = cfg.columns.some((c) => c.name === "tenant_id");
        if (hasTenantCol) {
          tablesWithTenant.push(cfg.name);
        }
      } catch {
        // No es una pgTable (ej. exports no tabla)
      }
    }

    const rlsCovered = new Set<string>([
      ...TENANT_STRICT_RLS_TABLES,
      "api_sessions",
      "api_keys",
    ]);

    const uncovered = tablesWithTenant.filter((name) => !rlsCovered.has(name));
    expect(uncovered).toEqual([]);
    expect(tablesWithTenant.length).toBeGreaterThanOrEqual(28);
  });

  it("applyTenantRlsAndViews emite SQL ENABLE/FORCE RLS y políticas app.current_tenant_id", async () => {
    const executedSql: string[] = [];
    const fakeDb = {
      execute: async (query: { queryChunks?: Array<{ value?: string[] }> }) => {
        const raw =
          query?.queryChunks?.flatMap((c) => c.value ?? []).join("") ??
          String(query);
        executedSql.push(raw);
      },
    } as unknown as Database;

    await applyTenantRlsAndViews(fakeDb);
    const joined = executedSql.join("\n");
    expect(joined).toContain('ENABLE ROW LEVEL SECURITY');
    expect(joined).toContain('FORCE ROW LEVEL SECURITY');
    expect(joined).toContain("current_setting('app.current_tenant_id', true)");
    expect(joined).toContain("CREATE OR REPLACE VIEW v_analisis_reposicion");
  });

  it("restringe gestión global de tenants por X-SaaS-Admin-Key/plataforma y aísla verificación de backups entre tenants", async () => {
    const cfg = {
      ...loadAppConfig(),
      saasAdminKey: "saas-super-platform-key-prod",
    };

    const tenantsStore = [
      {
        id: TENANT_DEFAULT_ID,
        slug: "default",
        name: "Plataforma Principal",
        plan: "enterprise" as const,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: TENANT_B_ID,
        slug: "cliente-b",
        name: "Cliente B",
        plan: "free" as const,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const fakeDb = {
      transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
        cb({ execute: async () => undefined }),
    } as unknown as Database;

    const authResolver: AuthResolver = async (request) => {
      const token = (request.headers.authorization ?? "").replace("Bearer ", "");
      if (token === "tok-default-master") {
        return {
          tenantId: TENANT_DEFAULT_ID,
          userId: 1,
          username: "Auditoria",
          role: "master",
          authType: "session",
        };
      }
      if (token === "tok-tenantb-master") {
        return {
          tenantId: TENANT_B_ID,
          userId: 2,
          username: "master_b",
          role: "master",
          authType: "session",
        };
      }
      return null;
    };

    const authRepo = {
      getTenantBySlug: async (slug: string) =>
        tenantsStore.find((t) => t.slug === slug) ?? null,
    } as unknown as TenantAuthRepository;

    const tenantAdminService = {
      listTenants: async () => tenantsStore,
      provisionTenant: async (input: { slug: string; name: string; plan: "free" | "pro" | "enterprise"; adminUsername: string }) => ({
        tenant: {
          id: "33333333-3333-4333-8333-333333333333",
          slug: input.slug,
          name: input.name,
          plan: input.plan,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        adminUser: {
          id: 99,
          username: input.adminUsername,
          role: "administrador" as const,
        },
      }),
      updateTenant: async (id: string, patch: { active?: boolean }) => ({
        ...tenantsStore[1]!,
        id,
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      }),
      getTenantUsage: async (tenantId: string) => ({
        tenant: tenantsStore.find((t) => t.id === tenantId) ?? tenantsStore[0]!,
        quotas: TENANT_PLAN_QUOTAS.free,
        usage: { usersCount: 2, productsCount: 40, storageBytes: 4096 },
        withinLimits: true,
      }),
    } as unknown as TenantAdminService;

    const snapshotDefault = createSignedTenantSnapshot({
      tenantId: TENANT_DEFAULT_ID,
      tenantSlug: "default",
      data: {
        products: [
          {
            code: "101",
            name: "Whey",
            stock: 10,
            stockFisico: 10,
            stockMinimo: 2,
            stockMaximo: 50,
            codBarras: "",
            ubicacion: "A-1",
            active: true,
          },
        ],
        customers: [],
        orders: [],
        stockMovements: [],
        storedFiles: [],
        auditLogs: [],
        chatMessages: [],
      },
    });

    const backupService = {
      exportTenantSnapshot: async (tenantId: string) =>
        createSignedTenantSnapshot({
          tenantId,
          tenantSlug: tenantId === TENANT_B_ID ? "cliente-b" : "default",
          data: snapshotDefault.data,
        }),
    } as unknown as TenantBackupService;

    const app = createApp({
      db: fakeDb,
      config: cfg,
      authResolver,
      authRepo,
      tenantAdminService,
      backupService,
      logger: false,
    });

    try {
      // Master de un tenant cliente (Cliente B) NO puede listar ni suspender otros tenants (403)
      const crossTenantList = await app.inject({
        method: "GET",
        url: "/api/v1/saas/tenants",
        headers: { authorization: "Bearer tok-tenantb-master" },
      });
      expect(crossTenantList.statusCode).toBe(403);

      // X-SaaS-Admin-Key sí puede provisionar un nuevo tenant
      const createTenant = await app.inject({
        method: "POST",
        url: "/api/v1/saas/tenants",
        headers: { "x-saas-admin-key": "saas-super-platform-key-prod" },
        payload: {
          slug: "tenant-c",
          name: "Empresa C SRL",
          plan: "pro",
          adminUsername: "admin_c",
          adminPassword: "PasswordSegura2026!",
        },
      });
      expect(createTenant.statusCode).toBe(201);
      expect(createTenant.json().tenant.slug).toBe("tenant-c");

      // Master de Cliente B NO puede verificar backup perteneciente al tenant Default (403)
      const crossBackupVerify = await app.inject({
        method: "POST",
        url: "/api/v1/saas/backup/verify",
        headers: { authorization: "Bearer tok-tenantb-master" },
        payload: { snapshot: snapshotDefault },
      });
      expect(crossBackupVerify.statusCode).toBe(403);

      // Master de Default exporta y verifica su propio snapshot
      const ownExport = await app.inject({
        method: "POST",
        url: "/api/v1/saas/backup/export",
        headers: { authorization: "Bearer tok-default-master" },
      });
      expect(ownExport.statusCode).toBe(200);
      const exported = ownExport.json().snapshot;
      expect(verifyTenantSnapshotIntegrity(exported).valid).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("Fase 6 - Observabilidad, Seguridad HTTP, Backups y Migración Legacy", () => {
  it("expone /ready, /metrics (con auth opcional), cabeceras de seguridad, X-Request-Id y rate limit global", async () => {
    const cfg = {
      ...loadAppConfig(),
      enableHsts: true,
      metricsToken: "prom-scrape-secret",
      rateLimitMax: 3,
      rateLimitWindowMs: 60_000,
    };

    let dbHealthy = true;
    const app = createApp({
      config: cfg,
      readinessProbe: async () => dbHealthy,
      logger: false,
    });

    try {
      const readyOk = await app.inject({ method: "GET", url: "/ready" });
      expect(readyOk.statusCode).toBe(200);
      expect(readyOk.json().status).toBe("ready");
      expect(readyOk.headers["x-request-id"]).toBeTruthy();
      expect(readyOk.headers["x-content-type-options"]).toBe("nosniff");
      expect(readyOk.headers["x-frame-options"]).toBe("DENY");
      expect(readyOk.headers["strict-transport-security"]).toContain("max-age=31536000");
      expect(readyOk.headers["permissions-policy"]).toContain("camera=(self)");

      // Si DB cae -> /ready devuelve 503 degraded
      dbHealthy = false;
      const readyDown = await app.inject({ method: "GET", url: "/api/v1/ready" });
      expect(readyDown.statusCode).toBe(503);
      expect(readyDown.json().status).toBe("degraded");

      // Rate limiter global bloquea en el 4to request no-infra mientras /health queda exento
      for (let i = 0; i < 3; i += 1) {
        const res = await app.inject({ method: "GET", url: "/api/v1/sistema/ping" });
        expect(res.statusCode).toBe(200);
      }
      const rateBlocked = await app.inject({
        method: "GET",
        url: "/api/v1/sistema/ping",
      });
      expect(rateBlocked.statusCode).toBe(429);
      expect(rateBlocked.headers["retry-after"]).toBeTruthy();

      // /health nunca se bloquea por rate limiter
      const healthExempt = await app.inject({ method: "GET", url: "/health" });
      expect(healthExempt.statusCode).toBe(200);

      // /metrics requiere METRICS_TOKEN si está configurado y emite formato Prometheus
      const metricsDenied = await app.inject({ method: "GET", url: "/metrics" });
      expect(metricsDenied.statusCode).toBe(401);

      const metricsOk = await app.inject({
        method: "GET",
        url: "/metrics",
        headers: { authorization: "Bearer prom-scrape-secret" },
      });
      expect(metricsOk.statusCode).toBe(200);
      expect(metricsOk.payload).toContain("stockagent_http_requests_total");
      expect(metricsOk.payload).toContain("stockagent_rate_limit_blocked_total 1");
      expect(metricsOk.payload).toContain("stockagent_ws_clients_connected 0");

      // Validar paths de redacción para logs estructurados
      expect(LOG_REDACTION_PATHS).toContain("req.headers.authorization");
      expect(LOG_REDACTION_PATHS).toContain("*.clientSecret");
    } finally {
      await app.close();
    }
  });

  it("valida configuración de producción, anti-SSRF y detección de corrupción en backups .json.gz", async () => {
    const prodIssues = validateProductionSecurityConfig({
      ...loadAppConfig(),
      nodeEnv: "production",
      databaseUrl: "postgresql://postgres:change-me@localhost:5432/stockagent",
      corsOrigins: ["*"],
    });
    expect(prodIssues.length).toBeGreaterThanOrEqual(2);

    expect(() =>
      assertSafeExternalUrl("http://169.254.169.254/latest/meta-data")
    ).toThrow(/https/i);
    expect(() => assertSafeExternalUrl("https://127.0.0.1/admin")).toThrow(
      /anti-SSRF/i
    );
    expect(() => assertSafeExternalUrl("https://10.0.0.12/hook")).toThrow(
      /anti-SSRF/i
    );
    expect(
      assertSafeExternalUrl("https://api.mercadolibre.com/orders/search").hostname
    ).toBe("api.mercadolibre.com");

    const dir = makeTempDir();
    const gzPath = join(dir, "tenant-backup.json.gz");
    const snap = createSignedTenantSnapshot({
      tenantId: TENANT_DEFAULT_ID,
      tenantSlug: "default",
      data: {
        products: [
          {
            code: "101",
            name: "Whey",
            stock: 25,
            stockFisico: 25,
            stockMinimo: 5,
            stockMaximo: 50,
            codBarras: "",
            ubicacion: "A1",
            active: true,
          },
        ],
        customers: [],
        orders: [],
        stockMovements: [],
        storedFiles: [],
        auditLogs: [],
        chatMessages: [],
      },
    });

    await writeGzippedJson(gzPath, snap);
    const loaded = (await readGzippedJson(gzPath)) as typeof snap;
    expect(verifyTenantSnapshotIntegrity(loaded).valid).toBe(true);

    // Manipular 1 unidad de stock debe invalidar la firma SHA-256
    loaded.data.products[0]!.stock = 9999;
    expect(verifyTenantSnapshotIntegrity(loaded).valid).toBe(false);
  });

  it("parseLegacyCatalogXlsx + importLegacyDatasetToTenant migra Excel/usuarios heredados con dry-run y sin duplicados", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Productos");
    sheet.addRow([
      "Codigo",
      "Descripcion",
      "Stock",
      "Stock Minimo",
      "Ubicacion",
      "Codigo Barras",
    ]);
    sheet.addRow(["101", "Proteina Whey 1kg", 30, 5, "a-01-1", "7791234567890"]);
    sheet.addRow(["101", "Proteina Whey Duplicado", 99, 5, "a-01-1", ""]);
    sheet.addRow(["202", "Creatina Micronizada", 12, 3, "b-02-4", ""]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const parsedXlsx = await parseLegacyCatalogXlsx(buf);
    expect(parsedXlsx.items).toHaveLength(2);
    expect(parsedXlsx.warnings).toHaveLength(1);
    expect(parsedXlsx.items[0]).toMatchObject({
      code: "101",
      stock: 30,
      ubicacion: "A-01-1",
    });

    const parsedUsers = normalizeLegacyUsers([
      {
        username: "operador_python",
        password_hash: PYTHON_LEGACY_HASH,
        role: "operador",
        nombre: "Operador Histórico",
      },
    ]);
    expect(parsedUsers.users).toHaveLength(1);
    expect(
      verifyPassword("StockAgent2026!", parsedUsers.users[0]!.passwordHash)
    ).toBe(true);

    // Simular DB transaccional para validar dry-run vs apply e idempotencia
    const insertedProducts: Array<{ id: number; code: string }> = [];
    const insertedUsers: Array<{ id: number; username: string }> = [];
    let nextId = 1;

    const createTxDb = () => {
      const fakeDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: TENANT_DEFAULT_ID,
                  slug: "default",
                  name: "Principal",
                  active: true,
                },
              ],
            }),
          }),
        }),
        transaction: async <T>(
          cb: (tx: unknown) => Promise<T>
        ): Promise<T> => {
          const tx = {
            execute: async () => undefined,
            select: () => ({
              from: (tbl: unknown) => ({
                where: async () => {
                  if (tbl === schema.products) {
                    return [...insertedProducts];
                  }
                  if (tbl === schema.users) {
                    return [...insertedUsers];
                  }
                  return [];
                },
              }),
            }),
            insert: (tbl: unknown) => ({
              values: async (vals: Record<string, unknown>) => {
                if (tbl === schema.products) {
                  insertedProducts.push({
                    id: nextId++,
                    code: String(vals.code),
                  });
                } else if (tbl === schema.users) {
                  insertedUsers.push({
                    id: nextId++,
                    username: String(vals.username),
                  });
                }
              },
            }),
          };
          return cb(tx);
        },
      };
      return fakeDb as unknown as Database;
    };

    const db = createTxDb();

    // Dry-run NO escribe en BD
    const dryReport = await importLegacyDatasetToTenant({
      db,
      tenantSlug: "default",
      products: parsedXlsx.items,
      users: parsedUsers.users,
      dryRun: true,
    });
    expect(dryReport.dryRun).toBe(true);
    expect(dryReport.productsInserted).toBe(2);
    expect(dryReport.usersInserted).toBe(1);
    expect(insertedProducts).toHaveLength(0);
    expect(insertedUsers).toHaveLength(0);

    // Apply SÍ persiste en BD
    const applyReport = await importLegacyDatasetToTenant({
      db,
      tenantSlug: "default",
      products: parsedXlsx.items,
      users: parsedUsers.users,
      dryRun: false,
    });
    expect(applyReport.dryRun).toBe(false);
    expect(insertedProducts).toHaveLength(2);
    expect(insertedUsers).toHaveLength(1);

    // Re-ejecución idempotente omite duplicados
    const rerunReport = await importLegacyDatasetToTenant({
      db,
      tenantSlug: "default",
      products: parsedXlsx.items,
      users: parsedUsers.users,
      dryRun: false,
    });
    expect(rerunReport.productsInserted).toBe(0);
    expect(rerunReport.usersSkipped).toBe(1);
    expect(insertedProducts).toHaveLength(2);
  });

  it("artefactos de despliegue Docker y Nginx están presentes y endurecidos", () => {
    const apiDocker = join(REPO_ROOT, "apps/api/Dockerfile");
    const webDocker = join(REPO_ROOT, "apps/web/Dockerfile");
    const nginxConf = join(REPO_ROOT, "apps/web/nginx.conf");
    const compose = join(REPO_ROOT, "docker-compose.yml");

    expect(existsSync(apiDocker)).toBe(true);
    expect(existsSync(webDocker)).toBe(true);
    expect(existsSync(nginxConf)).toBe(true);
    expect(existsSync(compose)).toBe(true);

    expect(readFileSync(apiDocker, "utf8")).toContain("USER node");
    expect(readFileSync(nginxConf, "utf8")).toContain("location /api/v1/ws");
    expect(readFileSync(compose, "utf8")).toContain("postgres:18-alpine");
  });
});

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EventBusDriverSchema,
  QueueDriverSchema,
  StorageDriverSchema,
  type EventBusDriver,
  type QueueDriver,
  type StorageDriver,
} from "@stockagent/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
let envLoaded = false;

/**
 * Carga variables desde `.env` si existe sin sobrescribir variables ya definidas en el entorno.
 */
export function loadEnvFileIfPresent(explicitPath?: string): string | null {
  if (envLoaded && !explicitPath) {
    return null;
  }

  const candidates = explicitPath
    ? [resolve(explicitPath)]
    : [
        resolve(process.cwd(), ".env"),
        resolve(__dirname, "../../.env"),
        resolve(__dirname, "../../../../.env"),
      ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    const content = readFileSync(candidate, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) {
        continue;
      }
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    envLoaded = true;
    return candidate;
  }

  envLoaded = true;
  return null;
}

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  publicScheme: string;
  trustProxy: boolean;
  enableHsts: boolean;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  metricsToken: string;
  saasAdminKey: string;
  corsOrigins: string[];
  defaultTenantSlug: string;
  databaseUrl: string;
  storageDriver: StorageDriver;
  storageLocalDir: string;
  storageMaxFileBytes: number;
  queueDriver: QueueDriver;
  eventBusDriver: EventBusDriver;
  redisUrl: string;
  s3: S3StorageConfig;
}

export function loadAppConfig(): AppConfig {
  loadEnvFileIfPresent();

  const portNum = Number(process.env.PORT ?? "3000");
  const maxMbNum = Number(process.env.STORAGE_MAX_FILE_MB ?? "25");
  const driverRaw = (process.env.STORAGE_DRIVER ?? "local").trim().toLowerCase();
  const storageDriver = StorageDriverSchema.parse(driverRaw);
  const queueDriver = QueueDriverSchema.parse(
    (process.env.QUEUE_DRIVER ?? "memory").trim().toLowerCase()
  );
  const eventBusDriver = EventBusDriverSchema.parse(
    (process.env.EVENT_BUS_DRIVER ?? "memory").trim().toLowerCase()
  );

  const rawLocalDir = (process.env.STORAGE_LOCAL_DIR ?? "./storage").trim();
  const monorepoRoot = resolve(__dirname, "../../../..");
  const storageLocalDir = resolve(monorepoRoot, rawLocalDir);

  const rawCorsOrigins = (
    process.env.CORS_ORIGIN ??
    "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173"
  )
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const rateLimitMaxNum = Number(process.env.RATE_LIMIT_MAX ?? "300");
  const rateLimitWindowNum = Number(process.env.RATE_LIMIT_WINDOW_MS ?? "60000");
  const nodeEnv = (process.env.NODE_ENV ?? "development").trim() || "development";

  return {
    nodeEnv,
    host: (process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    port: Number.isFinite(portNum) && portNum > 0 ? Math.trunc(portNum) : 3000,
    publicScheme:
      (process.env.STOCKAGENT_SCHEME ?? "http").trim().toUpperCase() || "HTTP",
    trustProxy: (process.env.TRUST_PROXY ?? "false").trim().toLowerCase() === "true",
    enableHsts:
      (process.env.ENABLE_HSTS ?? "").trim().toLowerCase() === "true" ||
      nodeEnv === "production",
    rateLimitMax:
      Number.isFinite(rateLimitMaxNum) && rateLimitMaxNum > 0
        ? Math.trunc(rateLimitMaxNum)
        : 300,
    rateLimitWindowMs:
      Number.isFinite(rateLimitWindowNum) && rateLimitWindowNum >= 1000
        ? Math.trunc(rateLimitWindowNum)
        : 60_000,
    metricsToken: (process.env.METRICS_TOKEN ?? "").trim(),
    saasAdminKey: (process.env.STOCKAGENT_SAAS_ADMIN_KEY ?? "").trim(),
    corsOrigins: rawCorsOrigins,
    defaultTenantSlug:
      (process.env.DEFAULT_TENANT_SLUG ?? "default").trim().toLowerCase() ||
      "default",
    databaseUrl: (process.env.DATABASE_URL ?? "").trim(),
    storageDriver,
    storageLocalDir,
    storageMaxFileBytes:
      Number.isFinite(maxMbNum) && maxMbNum > 0
        ? Math.trunc(maxMbNum * 1024 * 1024)
        : 25 * 1024 * 1024,
    queueDriver,
    eventBusDriver,
    redisUrl: (process.env.REDIS_URL ?? "").trim(),
    s3: {
      endpoint: (process.env.S3_ENDPOINT ?? "").trim(),
      region: (process.env.S3_REGION ?? "us-east-1").trim() || "us-east-1",
      bucket: (process.env.S3_BUCKET ?? "stockagent-files").trim(),
      accessKeyId: (process.env.S3_ACCESS_KEY_ID ?? "").trim(),
      secretAccessKey: (process.env.S3_SECRET_ACCESS_KEY ?? "").trim(),
      forcePathStyle:
        (process.env.S3_FORCE_PATH_STYLE ?? "true").trim().toLowerCase() !==
        "false",
    },
  };
}

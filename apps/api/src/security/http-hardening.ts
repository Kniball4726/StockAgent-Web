import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/env.js";
import { hashSha256 } from "./crypto.js";

const PLACEHOLDER_SECRETS = new Set([
  "",
  "replace-with-32-char-random-secret",
  "dev-only-secret",
  "change-me",
]);

/**
 * Valida la configuración mínima de seguridad cuando NODE_ENV=production.
 */
export function validateProductionSecurityConfig(config: AppConfig): string[] {
  const issues: string[] = [];
  if (config.nodeEnv !== "production") {
    return issues;
  }

  const encKey = (process.env.STOCKAGENT_ENCRYPTION_KEY ?? "").trim();
  if (PLACEHOLDER_SECRETS.has(encKey) || encKey.length < 32) {
    issues.push(
      "STOCKAGENT_ENCRYPTION_KEY debe estar definida y tener al menos 32 caracteres reales en producción."
    );
  }

  if (!config.databaseUrl || config.databaseUrl.includes("change-me")) {
    issues.push("DATABASE_URL debe usar credenciales reales en producción.");
  }

  if (config.corsOrigins.includes("*")) {
    issues.push(
      "CORS_ORIGIN no debe usar wildcard '*' en producción; configurá los orígenes explícitos."
    );
  }

  return issues;
}

/**
 * Compara secretos HTTP en tiempo constante para claves administrativas o métricas.
 */
export function constantTimeTokenEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Previene SSRF bloqueando destinos loopback, link-local / metadata cloud o IP privadas RFC1918
 * cuando la aplicación opera en entorno productivo.
 */
export function assertSafeExternalUrl(
  rawUrl: string,
  options: { allowPrivateHosts?: boolean } = {}
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL externa inválida.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Solo se permiten URLs http/https.");
  }

  if (options.allowPrivateHosts) {
    return parsed;
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Las integraciones externas en producción requieren HTTPS.");
  }

  const host = parsed.hostname.toLowerCase();
  const blockedExact = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "169.254.169.254",
    "metadata.google.internal",
  ]);
  if (
    blockedExact.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host) ||
    /^169\.254\.\d+\.\d+$/.test(host)
  ) {
    throw new Error(
      `Destino bloqueado por política anti-SSRF (${parsed.hostname}).`
    );
  }

  return parsed;
}

/**
 * Aplica cabeceras estándar de endurecimiento HTTP.
 */
export function applySecurityHeaders(
  reply: FastifyReply,
  config: Pick<AppConfig, "enableHsts">
): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  reply.header("Cross-Origin-Resource-Policy", "same-site");
  reply.header(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=()"
  );
  reply.header(
    "Content-Security-Policy",
    "default-src 'self'; frame-ancestors 'none'; base-uri 'self'"
  );
  if (config.enableHsts) {
    reply.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export class GlobalRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  consume(request: FastifyRequest): {
    allowed: boolean;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
  } {
    const now = Date.now();
    // Limpieza perezosa cuando crece el mapa
    if (this.buckets.size > 5000) {
      for (const [k, b] of this.buckets.entries()) {
        if (b.resetAt <= now) {
          this.buckets.delete(k);
        }
      }
    }

    const authHint =
      (request.headers["x-api-key"] as string | undefined) ??
      (request.headers.authorization as string | undefined) ??
      "";
    const key = authHint ? `${request.ip}:${hashSha256(authHint).slice(0, 16)}` : request.ip;

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, this.maxRequests - bucket.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000)
    );

    return {
      allowed: bucket.count <= this.maxRequests,
      limit: this.maxRequests,
      remaining,
      retryAfterSeconds,
    };
  }
}

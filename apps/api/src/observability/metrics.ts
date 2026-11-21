export const LOG_REDACTION_PATHS: string[] = [
  "req.headers.authorization",
  'req.headers["x-auth-token"]',
  'req.headers["x-api-key"]',
  'req.headers["x-saas-admin-key"]',
  "*.password",
  "*.current_password",
  "*.new_password",
  "*.clientSecret",
  "*.accessToken",
  "*.refreshToken",
  "*.rawKey",
  "*.api_key",
];

export function buildFastifyLoggerOptions(
  enabled: boolean,
  nodeEnv = "development"
):
  | boolean
  | {
      level: string;
      redact: {
        paths: string[];
        censor: string;
      };
    } {
  if (!enabled) {
    return false;
  }
  return {
    level: process.env.LOG_LEVEL?.trim() || (nodeEnv === "production" ? "info" : "info"),
    redact: {
      paths: LOG_REDACTION_PATHS,
      censor: "[REDACTED]",
    },
  };
}

const DURATION_BUCKETS_MS = [5, 15, 50, 100, 250, 500, 1000, 2500, 5000] as const;

function escapeLabelValue(val: string): string {
  return val
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

export class MetricsRegistry {
  private readonly requestCounts = new Map<string, number>();
  private readonly errorCounts = new Map<string, number>();
  private readonly durationBuckets = new Map<number, number>();
  private durationSumMs = 0;
  private durationTotalCount = 0;
  private authFailures = 0;
  private rateLimitBlocked = 0;
  private readonly startedAtMs = Date.now();

  constructor() {
    for (const b of DURATION_BUCKETS_MS) {
      this.durationBuckets.set(b, 0);
    }
  }

  recordHttpRequest(params: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void {
    const statusClass = `${Math.floor(params.statusCode / 100)}xx`;
    const key = `${params.method.toUpperCase()}|${params.route}|${statusClass}`;
    this.requestCounts.set(key, (this.requestCounts.get(key) ?? 0) + 1);

    if (params.statusCode === 401 || params.statusCode === 403 || params.statusCode === 423) {
      this.authFailures += 1;
    }
    if (params.statusCode === 429) {
      this.rateLimitBlocked += 1;
    }
    if (params.statusCode >= 400) {
      const errKey = String(params.statusCode);
      this.errorCounts.set(errKey, (this.errorCounts.get(errKey) ?? 0) + 1);
    }

    const dur = Math.max(0, params.durationMs);
    this.durationSumMs += dur;
    this.durationTotalCount += 1;
    for (const bound of DURATION_BUCKETS_MS) {
      if (dur <= bound) {
        this.durationBuckets.set(bound, (this.durationBuckets.get(bound) ?? 0) + 1);
      }
    }
  }

  renderPrometheusText(gauges: { wsClients?: number } = {}): string {
    const lines: string[] = [];

    lines.push("# HELP stockagent_http_requests_total Total de requests HTTP atendidos");
    lines.push("# TYPE stockagent_http_requests_total counter");
    for (const [compoundKey, value] of this.requestCounts.entries()) {
      const [method = "GET", route = "/", statusClass = "2xx"] = compoundKey.split("|");
      lines.push(
        `stockagent_http_requests_total{method="${escapeLabelValue(method)}",route="${escapeLabelValue(route)}",status_class="${escapeLabelValue(statusClass)}"} ${value}`
      );
    }

    lines.push("# HELP stockagent_http_errors_total Respuestas HTTP >= 400 por código");
    lines.push("# TYPE stockagent_http_errors_total counter");
    for (const [code, value] of this.errorCounts.entries()) {
      lines.push(
        `stockagent_http_errors_total{status="${escapeLabelValue(code)}"} ${value}`
      );
    }

    lines.push("# HELP stockagent_auth_failures_total Intentos fallidos de autenticación/autorización");
    lines.push("# TYPE stockagent_auth_failures_total counter");
    lines.push(`stockagent_auth_failures_total ${this.authFailures}`);

    lines.push("# HELP stockagent_rate_limit_blocked_total Requests bloqueados por rate limiter (429)");
    lines.push("# TYPE stockagent_rate_limit_blocked_total counter");
    lines.push(`stockagent_rate_limit_blocked_total ${this.rateLimitBlocked}`);

    lines.push("# HELP stockagent_http_request_duration_ms Latencia HTTP en milisegundos");
    lines.push("# TYPE stockagent_http_request_duration_ms histogram");
    for (const bound of DURATION_BUCKETS_MS) {
      lines.push(
        `stockagent_http_request_duration_ms_bucket{le="${bound}"} ${this.durationBuckets.get(bound) ?? 0}`
      );
    }
    lines.push(
      `stockagent_http_request_duration_ms_bucket{le="+Inf"} ${this.durationTotalCount}`
    );
    lines.push(
      `stockagent_http_request_duration_ms_sum ${this.durationSumMs.toFixed(3)}`
    );
    lines.push(
      `stockagent_http_request_duration_ms_count ${this.durationTotalCount}`
    );

    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor((Date.now() - this.startedAtMs) / 1000);
    lines.push("# HELP stockagent_uptime_seconds Tiempo activo del proceso API en segundos");
    lines.push("# TYPE stockagent_uptime_seconds gauge");
    lines.push(`stockagent_uptime_seconds ${uptimeSeconds}`);

    lines.push("# HELP stockagent_process_resident_memory_bytes Memoria RSS del proceso");
    lines.push("# TYPE stockagent_process_resident_memory_bytes gauge");
    lines.push(`stockagent_process_resident_memory_bytes ${mem.rss}`);

    if (gauges.wsClients !== undefined) {
      lines.push("# HELP stockagent_ws_clients_connected Clientes WebSocket activos");
      lines.push("# TYPE stockagent_ws_clients_connected gauge");
      lines.push(`stockagent_ws_clients_connected ${gauges.wsClients}`);
    }

    return `${lines.join("\n")}\n`;
  }
}

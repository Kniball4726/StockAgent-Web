import { createApp } from "./app.js";
import { loadAppConfig } from "./config/env.js";
import { createDbConnection } from "./db/client.js";
import { createRealtimeAdapters } from "./realtime/index.js";
import { validateProductionSecurityConfig } from "./security/http-hardening.js";
import { createStorageAdapter } from "./storage/index.js";

const config = loadAppConfig();
const securityIssues = validateProductionSecurityConfig(config);
if (securityIssues.length > 0) {
  console.error(
    `[startup] Configuración insegura para producción:\n- ${securityIssues.join("\n- ")}`
  );
  process.exit(1);
}

const dbConn = config.databaseUrl
  ? createDbConnection(config.databaseUrl)
  : null;
const storage = createStorageAdapter(config);
const realtime = createRealtimeAdapters(config);

const app = createApp({
  db: dbConn?.db,
  storage,
  config,
  eventBus: realtime.eventBus,
  queue: realtime.queue,
});

app.addHook("onClose", async () => {
  await Promise.allSettled([
    realtime.eventBus.close(),
    realtime.queue.close(),
    ...(dbConn ? [dbConn.pool.end()] : []),
  ]);
});

const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
let shuttingDown = false;
for (const sig of shutdownSignals) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal: sig }, "Apagado graceful iniciado...");
    void app.close().then(() => {
      process.exit(0);
    });
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

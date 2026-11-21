import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createGunzip, createGzip } from "node:zlib";
import { sql } from "drizzle-orm";
import { loadEnvFileIfPresent } from "../config/env.js";
import { createDbConnection } from "../db/client.js";
import { tenants } from "../db/schema/index.js";
import {
  TenantBackupService,
  verifyTenantSnapshotIntegrity,
} from "../saas/backup-service.js";
import { hashSha256 } from "../security/crypto.js";

function parseFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }
  return undefined;
}

export async function writeGzippedJson(
  outPath: string,
  payload: unknown
): Promise<{ outPath: string; sha256: string }> {
  const absOut = resolve(outPath);
  await mkdir(dirname(absOut), { recursive: true });
  const jsonBuf = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  const gzip = createGzip({ level: 6 });
  const dest = createWriteStream(absOut);
  const done = pipeline(gzip, dest);
  gzip.end(jsonBuf);
  await done;

  const compressed = await readFile(absOut);
  const sha256 = hashSha256(compressed);
  await writeFile(`${absOut}.sha256`, `${sha256}  ${basename(absOut)}\n`, "utf8");
  return { outPath: absOut, sha256 };
}

export async function readGzippedJson(inPath: string): Promise<unknown> {
  const absIn = resolve(inPath);
  const expectedLine = await readFile(`${absIn}.sha256`, "utf8").catch(
    () => null
  );
  if (expectedLine) {
    const expectedHash = expectedLine.trim().split(/\s+/)[0] ?? "";
    const rawCompressed = await readFile(absIn);
    const actualHash = hashSha256(rawCompressed);
    if (expectedHash && actualHash !== expectedHash) {
      throw new Error("Checksum .sha256 del archivo comprimido no coincide.");
    }
  }

  const chunks: Buffer[] = [];
  const gunzip = createGunzip();
  gunzip.on("data", (chunk: Buffer) => chunks.push(chunk));
  await pipeline(createReadStream(absIn), gunzip);
  const rawJson = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(rawJson);
}

export async function runPgDumpBackup(
  databaseUrl: string,
  outFile: string
): Promise<{ outFile: string; sha256: string }> {
  const absOut = resolve(outFile);
  await mkdir(dirname(absOut), { recursive: true });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(
      "pg_dump",
      ["--no-owner", "--no-privileges", "--format=plain", databaseUrl],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const gzip = createGzip({ level: 6 });
    const outStream = createWriteStream(absOut);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.stdout.pipe(gzip).pipe(outStream);
    child.on("error", rejectPromise);
    outStream.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        outStream.once("finish", () => resolvePromise());
      } else {
        rejectPromise(
          new Error(`pg_dump finalizó con código ${code}: ${stderr.trim()}`)
        );
      }
    });
  });

  const compressed = await readFile(absOut);
  const sha256 = hashSha256(compressed);
  await writeFile(`${absOut}.sha256`, `${sha256}  ${basename(absOut)}\n`, "utf8");
  return { outFile: absOut, sha256 };
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  loadEnvFileIfPresent();
  const argv = process.argv.slice(2);
  const verifyPath = parseFlag(argv, "--verify");
  const pgDumpPath = parseFlag(argv, "--pg-dump");
  const tenantSlug = parseFlag(argv, "--tenant") ?? "default";
  const outFlag = parseFlag(argv, "--out");

  if (verifyPath) {
    const raw = await readGzippedJson(verifyPath);
    const check = verifyTenantSnapshotIntegrity(raw);
    if (!check.valid) {
      console.error(`[backup:verify] FALLÓ: ${check.reason}`);
      process.exit(1);
    }
    console.log(
      `[backup:verify] OK (${check.snapshot?.tenantSlug}, sha256=${check.snapshot?.sha256Checksum})`
    );
  } else if (pgDumpPath) {
    const dbUrl = (process.env.DATABASE_URL ?? "").trim();
    if (!dbUrl) {
      console.error("[backup:pg] Falta DATABASE_URL en entorno.");
      process.exit(1);
    }
    const res = await runPgDumpBackup(dbUrl, pgDumpPath);
    console.log(`[backup:pg] OK -> ${res.outFile} (sha256=${res.sha256})`);
  } else {
    const { pool, db } = createDbConnection();
    try {
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(sql`lower(${tenants.slug}) = lower(${tenantSlug})`)
        .limit(1);
      if (!tenant) {
        console.error(`[backup:tenant] Tenant '${tenantSlug}' no encontrado.`);
        process.exit(1);
      }
      const svc = new TenantBackupService(db);
      const snapshot = await svc.exportTenantSnapshot(tenant.id);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outPath =
        outFlag ?? `./backups/${tenant.slug}-${stamp}.json.gz`;
      const written = await writeGzippedJson(outPath, snapshot);
      console.log(
        `[backup:tenant] OK -> ${written.outPath} (archivo sha256=${written.sha256}, snapshot=${snapshot.sha256Checksum})`
      );
    } finally {
      await pool.end();
    }
  }
}

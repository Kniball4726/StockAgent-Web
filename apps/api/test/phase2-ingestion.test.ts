import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consolidarDocumentos,
  simularImpactoStock,
  type CatalogProductSnapshot,
} from "@stockagent/shared";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/client.js";
import type { AuthContext } from "../src/http/auth-context.js";
import type { AuditChatRepository } from "../src/repositories/audit-chat-repository.js";
import { ConflictError, NotFoundError } from "../src/repositories/base.js";
import type { OrderRepository } from "../src/repositories/order-repository.js";
import type { ProductRepository } from "../src/repositories/product-repository.js";
import { hashSha256 } from "../src/security/crypto.js";
import { FileUploadService } from "../src/services/file-service.js";
import { IngestionService } from "../src/services/ingestion-service.js";
import {
  assertKeyBelongsToTenant,
  LocalStorageAdapter,
  S3StorageAdapter,
  sanitizeUploadFilename,
} from "../src/storage/index.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

async function encodeFormData(form: FormData) {
  const req = new Request("http://localhost/upload", {
    method: "POST",
    body: form,
  });
  const body = Buffer.from(await req.arrayBuffer());
  const contentType = req.headers.get("content-type") ?? "";
  return { body, contentType };
}

interface FakeProduct extends CatalogProductSnapshot {
  tenantId: string;
  active: boolean;
}

interface FakeStoredFile {
  id: string;
  tenantId: string;
  category: string;
  originalName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  createdAt: Date;
}

interface FakeOrder {
  id: number;
  tenantId: string;
  notaPedido: string;
  archivoHash: string;
  archivoDescuentoKey: string;
  estado: "descontado" | "anulado";
  articulosDescontados: number;
  itemsSinCoincidencia: Array<[string, string]>;
  agregado: boolean;
}

interface HarnessState {
  products: FakeProduct[];
  storedFiles: FakeStoredFile[];
  orders: FakeOrder[];
  dispatches: Array<{ id: number; tenantId: string; totalUnidades: number }>;
  movements: Array<{ tenantId: string; codigo: string; delta: number; type: string }>;
  inventories: Array<{ id: number; tenantId: string; conteo: Record<string, number> }>;
  processedTx: Set<string>;
  auditLogs: Array<{ tenantId: string; accion: string; detalle: string }>;
  seq: number;
}

function createTransactionalFakeHarness() {
  let state: HarnessState = {
    products: [
      {
        id: 1,
        tenantId: TENANT_A,
        code: "101",
        name: "Proteína Whey 1kg",
        stock: 50,
        stockMinimo: 10,
        stockMaximo: 150,
        codBarras: "7791234567890",
        ubicacion: "A1",
        active: true,
      },
      {
        id: 2,
        tenantId: TENANT_A,
        code: "201",
        name: "Creatina 300g",
        stock: 8,
        stockMinimo: 5,
        stockMaximo: 80,
        codBarras: "7791234567892",
        ubicacion: "B1",
        active: true,
      },
      {
        id: 3,
        tenantId: TENANT_B,
        code: "101",
        name: "Producto Otro Tenant",
        stock: 99,
        stockMinimo: 5,
        stockMaximo: 200,
        codBarras: "7790000000001",
        ubicacion: "Z9",
        active: true,
      },
    ],
    storedFiles: [],
    orders: [],
    dispatches: [],
    movements: [],
    inventories: [],
    processedTx: new Set(),
    auditLogs: [],
    seq: 10,
  };

  const fakeDb = {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(state);
      try {
        return await cb({ execute: async () => undefined });
      } catch (err) {
        state = snapshot;
        throw err;
      }
    },
  } as unknown as Database;

  const productRepo = {
    listProducts: async (scope: { tenantId: string }, onlyActive = true) =>
      state.products.filter(
        (p) => p.tenantId === scope.tenantId && (!onlyActive || p.active)
      ),
    applyBatchDiscounts: async (
      scope: { tenantId: string },
      input: { items: Array<{ codigo: string; cantidad: number }> }
    ) => {
      let totalUnidades = 0;
      for (const item of input.items) {
        const prod = state.products.find(
          (p) =>
            p.tenantId === scope.tenantId &&
            p.code.toLowerCase() === item.codigo.toLowerCase()
        );
        if (!prod) {
          throw new NotFoundError(`Código '${item.codigo}' no encontrado.`);
        }
        prod.stock -= item.cantidad;
        totalUnidades += item.cantidad;
        state.movements.push({
          tenantId: scope.tenantId,
          codigo: prod.code,
          delta: -item.cantidad,
          type: "descuento",
        });
      }
      state.seq += 1;
      state.dispatches.push({
        id: state.seq,
        tenantId: scope.tenantId,
        totalUnidades,
      });
      return { dispatchId: state.seq, totalUnidades, detalles: [] };
    },
    adjustStockAtomic: async (
      scope: { tenantId: string },
      input: { codigo: string; delta: number; movementType: string }
    ) => {
      const prod = state.products.find(
        (p) =>
          p.tenantId === scope.tenantId &&
          p.code.toLowerCase() === input.codigo.toLowerCase()
      );
      if (!prod) {
        throw new NotFoundError(`Código '${input.codigo}' no encontrado.`);
      }
      const stockAnterior = prod.stock;
      prod.stock += input.delta;
      state.movements.push({
        tenantId: scope.tenantId,
        codigo: prod.code,
        delta: input.delta,
        type: input.movementType,
      });
      return { product: prod, stockAnterior, stockNuevo: prod.stock };
    },
    recordPhysicalInventory: async (
      scope: { tenantId: string },
      input: { conteo: Record<string, number> }
    ) => {
      state.seq += 1;
      state.inventories.push({
        id: state.seq,
        tenantId: scope.tenantId,
        conteo: input.conteo,
      });
      return { inventoryId: state.seq, items: [], totalDiferencias: 0 };
    },
  } as unknown as ProductRepository;

  const orderRepo = {
    findExistingOrdersByNotas: async (
      scope: { tenantId: string },
      notas: readonly string[]
    ) => {
      const lowerSet = new Set(notas.map((n) => n.trim().toLowerCase()));
      return new Set(
        state.orders
          .filter(
            (o) =>
              o.tenantId === scope.tenantId &&
              lowerSet.has(o.notaPedido.toLowerCase())
          )
          .map((o) => o.notaPedido)
      );
    },
    findConfirmedOrdersByHashes: async (
      scope: { tenantId: string },
      hashes: readonly string[]
    ) => {
      const hashSet = new Set(hashes.map((h) => h.trim()).filter(Boolean));
      const map = new Map<string, string>();
      for (const o of state.orders) {
        if (
          o.tenantId === scope.tenantId &&
          o.estado === "descontado" &&
          hashSet.has(o.archivoHash)
        ) {
          map.set(o.archivoHash, o.notaPedido);
        }
      }
      return map;
    },
    registerIdempotentTx: async (
      scope: { tenantId: string },
      txId: string
    ) => {
      const key = `${scope.tenantId}:${txId}`;
      if (state.processedTx.has(key)) {
        return false;
      }
      state.processedTx.add(key);
      return true;
    },
    registerOrder: async (
      scope: { tenantId: string },
      input: {
        notaPedido: string;
        archivoHash?: string;
        archivoDescuentoKey?: string;
        articulosDescontados?: number;
        itemsSinCoincidencia?: Array<[string, string]>;
        agregado?: boolean;
      }
    ) => {
      const dup = state.orders.find(
        (o) =>
          o.tenantId === scope.tenantId &&
          o.notaPedido.toLowerCase() === input.notaPedido.toLowerCase()
      );
      if (dup) {
        throw new ConflictError(
          `El remito '${input.notaPedido}' ya fue registrado.`
        );
      }
      state.seq += 1;
      const created: FakeOrder = {
        id: state.seq,
        tenantId: scope.tenantId,
        notaPedido: input.notaPedido,
        archivoHash: input.archivoHash ?? "",
        archivoDescuentoKey: input.archivoDescuentoKey ?? "",
        estado: "descontado",
        articulosDescontados: input.articulosDescontados ?? 0,
        itemsSinCoincidencia: input.itemsSinCoincidencia ?? [],
        agregado: Boolean(input.agregado),
      };
      state.orders.push(created);
      return created;
    },
  } as unknown as OrderRepository;

  const auditRepo = {
    findStoredFileBySha256: async (
      scope: { tenantId: string },
      sha256: string
    ) =>
      state.storedFiles.find(
        (f) => f.tenantId === scope.tenantId && f.sha256 === sha256
      ) ?? null,
    registerStoredFile: async (
      scope: { tenantId: string },
      input: Omit<FakeStoredFile, "id" | "tenantId" | "createdAt">
    ) => {
      const row: FakeStoredFile = {
        id: `00000000-0000-4000-8000-${String(++state.seq).padStart(12, "0")}`,
        tenantId: scope.tenantId,
        ...input,
        createdAt: new Date(),
      };
      state.storedFiles.push(row);
      return row;
    },
    listStoredFiles: async (
      scope: { tenantId: string },
      opts: { category?: string; limit?: number } = {}
    ) =>
      state.storedFiles
        .filter(
          (f) =>
            f.tenantId === scope.tenantId &&
            (!opts.category || f.category === opts.category)
        )
        .slice(0, opts.limit ?? 50),
    getStoredFileById: async (scope: { tenantId: string }, id: string) =>
      state.storedFiles.find(
        (f) => f.tenantId === scope.tenantId && f.id === id
      ) ?? null,
    deleteStoredFileById: async (scope: { tenantId: string }, id: string) => {
      const idx = state.storedFiles.findIndex(
        (f) => f.tenantId === scope.tenantId && f.id === id
      );
      if (idx < 0) {
        throw new NotFoundError(`Archivo '${id}' no encontrado.`);
      }
      const existing = state.storedFiles[idx]!;
      const linked = state.orders.find(
        (o) =>
          o.tenantId === scope.tenantId &&
          o.estado === "descontado" &&
          (o.archivoDescuentoKey === existing.storageKey ||
            (existing.sha256 && o.archivoHash === existing.sha256))
      );
      if (linked) {
        throw new ConflictError(
          `Respalda pedido confirmado '${linked.notaPedido}'.`
        );
      }
      state.storedFiles.splice(idx, 1);
      return existing;
    },
    logAudit: async (
      scope: { tenantId: string },
      _usuario: string,
      accion: string,
      detalle: string
    ) => {
      state.auditLogs.push({ tenantId: scope.tenantId, accion, detalle });
      return null;
    },
  } as unknown as AuditChatRepository;

  return {
    getState: () => state,
    fakeDb,
    productRepo,
    orderRepo,
    auditRepo,
  };
}

describe("Fase 2 - Consolidación y simulación pura sin escrituras", () => {
  const catalog: CatalogProductSnapshot[] = [
    {
      id: 1,
      code: "101",
      name: "Whey 1kg",
      stock: 10,
      stockMinimo: 4,
      stockMaximo: 50,
      codBarras: "7791234567890",
      ubicacion: "A1",
    },
    {
      id: 2,
      code: "201",
      name: "Creatina 300g",
      stock: 5,
      stockMinimo: 5,
      stockMaximo: 40,
      codBarras: "7791234567892",
      ubicacion: "B1",
    },
  ];

  it("consolidarDocumentos agrupa códigos repetidos y conserva remitos de origen", () => {
    const res = consolidarDocumentos([
      {
        notaPedido: "NP-001",
        items: [
          { codigo: "101.0", descripcion: "Whey", cantidad: 4 },
          { codigo: "201", descripcion: "Creatina", cantidad: 2 },
        ],
      },
      {
        notaPedido: "NP-002",
        items: [{ codigo: "101", descripcion: "", cantidad: 3 }],
      },
    ]);

    expect(res.totalUnidades).toBe(9);
    expect(res.items).toHaveLength(2);
    expect(res.duplicados).toHaveLength(1);
    expect(res.duplicados[0]).toMatchObject({
      codigo: "101",
      cantidadTotal: 7,
      repeticiones: 2,
      remitosOrigen: ["NP-001", "NP-002"],
    });
  });

  it("simularImpactoStock detecta quiebres, barcodes, sin coincidencia y duplicados", () => {
    const sim = simularImpactoStock({
      operation: "descuento_pedidos",
      catalog,
      existingNotas: new Set(["NP-001"]),
      existingHashes: new Map([["hash-old", "NP-OLD"]]),
      documents: [
        {
          notaPedido: "NP-001",
          numeroPedido: "",
          cliente: "Cliente A",
          bultos: 1,
          logistica: "Domicilio",
          armador: "",
          tipoArchivo: "pdf",
          nombreArchivo: "np1.pdf",
          fechaRetiro: "",
          archivoHash: "hash-old",
          numeroGuia: "",
          articulosDeclarados: 10,
          items: [
            {
              codigo: "07791234567890",
              descripcion: "Whey EAN13",
              cantidad: 11,
              origenRemito: "",
            },
            {
              codigo: "999",
              descripcion: "SKU Inexistente",
              cantidad: 2,
              origenRemito: "",
            },
          ],
        },
      ],
    });

    expect(sim.canConfirm).toBe(false);
    expect(sim.duplicateNotas).toEqual(["NP-001"]);
    expect(sim.duplicateHashes).toEqual([
      { archivoHash: "hash-old", existingNotaPedido: "NP-OLD" },
    ]);
    expect(sim.quiebres).toHaveLength(1);
    expect(sim.quiebres[0]).toMatchObject({
      codigoCatalogo: "101",
      stockAnterior: 10,
      delta: -11,
      stockNuevo: -1,
      quiebre: true,
    });
    expect(sim.unmatchedItems).toHaveLength(1);
    expect(sim.warnings.some((w) => w.includes("Discrepancia"))).toBe(true);
  });
});

describe("Fase 2 - Adaptadores de almacenamiento Local y S3", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "stockagent-storage-"));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("LocalStorageAdapter guarda, lee, valida tenant y bloquea path traversal", async () => {
    const storage = new LocalStorageAdapter(tempRoot);
    const payload = Buffer.from("%PDF-1.4\nremito de prueba");
    const sha = hashSha256(payload);
    const key = storage.buildTenantKey({
      tenantId: TENANT_A,
      category: "remito_mayorista",
      sha256: sha,
      originalName: "Remito Cámpora #1.pdf",
    });

    expect(key).toMatch(
      new RegExp(`^tenants/${TENANT_A}/remito_mayorista/\\d{4}/\\d{2}/${sha.slice(0, 16)}_Remito_Campora_1\\.pdf$`)
    );

    const saved = await storage.putObject({
      key,
      body: payload,
      contentType: "application/pdf",
    });
    expect(saved.sizeBytes).toBe(payload.byteLength);

    const readBack = await storage.getObject(key);
    expect(readBack.body.equals(payload)).toBe(true);
    expect(readBack.metadata.contentType).toBe("application/pdf");

    expect(() => assertKeyBelongsToTenant(key, TENANT_B)).toThrow();
    expect(() => sanitizeUploadFilename("../secreto.exe")).toThrow();
    await expect(storage.getObject("../escape.pdf")).rejects.toThrow();
    await expect(storage.headObject(`${key}.meta.json`)).rejects.toThrow();

    await storage.deleteObject(key);
    expect(await storage.headObject(key)).toBeNull();
  });

  it("S3StorageAdapter firma peticiones SigV4 (PUT/GET/HEAD/DELETE)", async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const store = new Map<string, { body: Buffer; type: string }>();

    const mockFetch: typeof fetch = async (input, init) => {
      const url = input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const hdrs = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method, headers: hdrs });

      if (method === "PUT") {
        const rawBody = init?.body as Uint8Array;
        store.set(url, {
          body: Buffer.from(rawBody),
          type: hdrs["content-type"] ?? "application/octet-stream",
        });
        return new Response(null, { status: 200, headers: { etag: '"abc123"' } });
      }
      if (method === "HEAD") {
        const obj = store.get(url);
        if (!obj) return new Response(null, { status: 404 });
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": String(obj.body.byteLength),
            "content-type": obj.type,
            etag: '"abc123"',
          },
        });
      }
      if (method === "GET") {
        const obj = store.get(url);
        if (!obj) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(obj.body), {
          status: 200,
          headers: { "content-type": obj.type, etag: '"abc123"' },
        });
      }
      store.delete(url);
      return new Response(null, { status: 204 });
    };

    const s3 = new S3StorageAdapter({
      endpoint: "https://minio.local:9000",
      region: "us-east-1",
      bucket: "stockagent-test",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "SECRET_TEST",
      forcePathStyle: true,
      fetchFn: mockFetch,
    });

    const data = Buffer.from("codigo,cantidad\n101,5\n");
    const key = s3.buildTenantKey({
      tenantId: TENANT_A,
      category: "canje",
      sha256: hashSha256(data),
      originalName: "canje.csv",
    });

    const putMeta = await s3.putObject({
      key,
      body: data,
      contentType: "text/csv; charset=utf-8",
    });
    expect(putMeta.etag).toBe("abc123");
    expect(calls[0]?.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIA_TEST\//);
    expect(calls[0]?.headers["x-amz-content-sha256"]).toBe(hashSha256(data));
    expect(calls[0]?.url).toContain("/stockagent-test/tenants/");

    const downloaded = await s3.getObject(key);
    expect(downloaded.body.equals(data)).toBe(true);

    await s3.deleteObject(key);
    expect(await s3.headObject(key)).toBeNull();
  });
});

describe("Fase 2 - Endpoints Fastify de carga, deduplicación, simulación y confirmación", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stockagent-api-phase2-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function buildTestApp(harness = createTransactionalFakeHarness()) {
    const storage = new LocalStorageAdapter(tempDir);
    const fileService = new FileUploadService(
      storage,
      harness.auditRepo,
      harness.orderRepo,
      1024 * 1024
    );
    const ingestionService = new IngestionService(
      harness.productRepo,
      harness.orderRepo,
      harness.auditRepo
    );

    const authResolver = async (req: { headers: Record<string, unknown> }): Promise<AuthContext | null> => {
      const token = String(req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
      if (token === "operador-a") {
        return {
          tenantId: TENANT_A,
          userId: 10,
          username: "juan_op",
          role: "operador",
          authType: "session",
        };
      }
      if (token === "consulta-a") {
        return {
          tenantId: TENANT_A,
          userId: 11,
          username: "lector_a",
          role: "consulta",
          authType: "session",
        };
      }
      if (token === "operador-b") {
        return {
          tenantId: TENANT_B,
          userId: 20,
          username: "maria_b",
          role: "operador",
          authType: "session",
        };
      }
      return null;
    };

    const app = createApp({
      db: harness.fakeDb,
      storage,
      authResolver: authResolver as never,
      fileService,
      ingestionService,
      logger: false,
    });

    return { app, harness };
  }

  it("exige autenticación y aplica control de roles (consulta bloqueado para escrituras)", async () => {
    const { app } = buildTestApp();
    try {
      const noAuth = await app.inject({ method: "GET", url: "/api/v1/files" });
      expect(noAuth.statusCode).toBe(401);

      const consultaSim = await app.inject({
        method: "POST",
        url: "/api/v1/ingestion/simulate",
        headers: { authorization: "Bearer consulta-a" },
        payload: {
          operation: "descuento_pedidos",
          documents: [{ notaPedido: "NP-1", items: [{ codigo: "101", cantidad: 1 }] }],
        },
      });
      expect(consultaSim.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("sube archivos desde PC, deduplica por SHA-256, sirve inline/attachment y aísla por tenant", async () => {
    const { app } = buildTestApp();
    try {
      const pdfBytes = Buffer.from("%PDF-1.4\nContenido remito NP-500");
      const form1 = new FormData();
      form1.set("category", "remito_mayorista");
      form1.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "remito_500.pdf");
      const enc1 = await encodeFormData(form1);

      const upload1 = await app.inject({
        method: "POST",
        url: "/api/v1/files/upload",
        headers: {
          authorization: "Bearer operador-a",
          "content-type": enc1.contentType,
        },
        payload: enc1.body,
      });
      expect(upload1.statusCode).toBe(201);
      const body1 = upload1.json();
      expect(body1.files).toHaveLength(1);
      expect(body1.files[0].file.deduplicated).toBe(false);
      const fileId = body1.files[0].file.id as string;

      // Re-subir el mismo archivo dentro del mismo tenant deduplica sin duplicar blob
      const form2 = new FormData();
      form2.set("category", "remito_mayorista");
      form2.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "copia_500.pdf");
      const enc2 = await encodeFormData(form2);

      const upload2 = await app.inject({
        method: "POST",
        url: "/api/v1/files/upload",
        headers: {
          authorization: "Bearer operador-a",
          "content-type": enc2.contentType,
        },
        payload: enc2.body,
      });
      expect(upload2.statusCode).toBe(201);
      const body2 = upload2.json();
      expect(body2.files[0].file.id).toBe(fileId);
      expect(body2.files[0].file.deduplicated).toBe(true);

      // Descarga inline en Tenant A OK, acceso desde Tenant B devuelve 404
      const viewA = await app.inject({
        method: "GET",
        url: `/api/v1/files/${fileId}/content`,
        headers: { authorization: "Bearer operador-a" },
      });
      expect(viewA.statusCode).toBe(200);
      expect(viewA.headers["content-disposition"]).toContain("inline;");
      expect(viewA.rawPayload.equals(pdfBytes)).toBe(true);

      const viewB = await app.inject({
        method: "GET",
        url: `/api/v1/files/${fileId}/content`,
        headers: { authorization: "Bearer operador-b" },
      });
      expect(viewB.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("simula sin modificar stock y confirma transaccionalmente con idempotencia y rollback ante fallo", async () => {
    const { app, harness } = buildTestApp();
    try {
      const csvBytes = Buffer.from("codigo,cantidad\n101,5\n");
      const sha = hashSha256(csvBytes);

      const form = new FormData();
      form.set("category", "canje");
      form.append("file", new Blob([csvBytes], { type: "text/csv" }), "canje_1.csv");
      const enc = await encodeFormData(form);
      const up = await app.inject({
        method: "POST",
        url: "/api/v1/files/upload",
        headers: {
          authorization: "Bearer operador-a",
          "content-type": enc.contentType,
        },
        payload: enc.body,
      });
      const sourceFileId = up.json().files[0].file.id as string;

      // 1. Simulación sin escrituras
      const simRes = await app.inject({
        method: "POST",
        url: "/api/v1/ingestion/simulate",
        headers: { authorization: "Bearer operador-a" },
        payload: {
          operation: "descuento_pedidos",
          documents: [
            {
              sourceFileId,
              notaPedido: "NP-CANJE-1",
              cliente: "Influencer Demo",
              logistica: "Canje",
              tipoArchivo: "excel",
              nombreArchivo: "canje_1.csv",
              archivoHash: sha,
              items: [
                { codigo: "101", cantidad: 12 },
                { codigo: "7791234567892", cantidad: 4 },
              ],
            },
          ],
        },
      });
      expect(simRes.statusCode).toBe(200);
      expect(simRes.json().simulation.canConfirm).toBe(true);
      // Stock sigue intacto tras simulación
      expect(harness.getState().products[0]?.stock).toBe(50);

      // 2. Confirmación transaccional con Idempotency-Key
      const confirmRes = await app.inject({
        method: "POST",
        url: "/api/v1/ingestion/confirm",
        headers: {
          authorization: "Bearer operador-a",
          "idempotency-key": "tx-canje-001",
        },
        payload: {
          operation: "descuento_pedidos",
          documents: [
            {
              sourceFileId,
              notaPedido: "NP-CANJE-1",
              cliente: "Influencer Demo",
              logistica: "Canje",
              tipoArchivo: "excel",
              nombreArchivo: "canje_1.csv",
              archivoHash: sha,
              items: [
                { codigo: "101", cantidad: 12 },
                { codigo: "7791234567892", cantidad: 4 },
              ],
            },
          ],
        },
      });
      expect(confirmRes.statusCode).toBe(201);
      const confirmBody = confirmRes.json().result;
      expect(confirmBody.totalUnidadesAplicadas).toBe(16);
      expect(confirmBody.orderIds).toHaveLength(1);
      expect(harness.getState().products[0]?.stock).toBe(38);
      expect(harness.getState().products[1]?.stock).toBe(4);
      expect(harness.getState().products[2]?.stock).toBe(99); // Tenant B intacto

      // 3. Reintento con misma Idempotency-Key rechazado (409) sin volver a descontar
      const retryRes = await app.inject({
        method: "POST",
        url: "/api/v1/ingestion/confirm",
        headers: {
          authorization: "Bearer operador-a",
          "idempotency-key": "tx-canje-001",
        },
        payload: {
          operation: "descuento_pedidos",
          documents: [
            {
              notaPedido: "NP-CANJE-2",
              cliente: "Otro",
              items: [{ codigo: "101", cantidad: 5 }],
            },
          ],
        },
      });
      expect(retryRes.statusCode).toBe(409);
      expect(harness.getState().products[0]?.stock).toBe(38);

      // 4. Eliminar un archivo que ya respalda un pedido confirmado falla con 409
      const delLinked = await app.inject({
        method: "DELETE",
        url: `/api/v1/files/${sourceFileId}`,
        headers: { authorization: "Bearer operador-a" },
      });
      expect(delLinked.statusCode).toBe(409);

      // 5. Subir un batch donde el 2do pedido duplica el 1ro revierte todo atómicamente (rollback)
      const rollbackRes = await app.inject({
        method: "POST",
        url: "/api/v1/ingestion/confirm",
        headers: { authorization: "Bearer operador-a" },
        payload: {
          operation: "descuento_pedidos",
          documents: [
            {
              notaPedido: "NP-NEW-ROLLBACK",
              cliente: "Cliente X",
              items: [{ codigo: "101", cantidad: 10 }],
            },
            {
              notaPedido: "NP-CANJE-1", // ya existe
              cliente: "Cliente Y",
              items: [{ codigo: "101", cantidad: 2 }],
            },
          ],
        },
      });
      expect(rollbackRes.statusCode).toBe(409);
      expect(harness.getState().products[0]?.stock).toBe(38);
      expect(harness.getState().orders).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

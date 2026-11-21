import { describe, expect, it } from "vitest";
import {
  coincideCodigoOBarras,
  generarVariantesCodigoLector,
  LOCKOUT_SECONDS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  normalizarCodigo,
  type UserRole,
} from "@stockagent/shared";
import { createApp } from "../src/app.js";
import { loadAppConfig } from "../src/config/env.js";
import type { Database } from "../src/db/client.js";
import type { AuthResolver } from "../src/http/auth-context.js";
import {
  createEventBusAdapter,
  createQueueAdapter,
  InMemoryEventBus,
  InMemoryQueueAdapter,
} from "../src/realtime/index.js";
import type { AuditChatRepository } from "../src/repositories/audit-chat-repository.js";
import { ForbiddenError, NotFoundError } from "../src/repositories/base.js";
import type { OrderRepository } from "../src/repositories/order-repository.js";
import type { ProductRepository } from "../src/repositories/product-repository.js";
import type {
  AuthDetailedResult,
  SafeUserRecord,
  TenantAuthRepository,
} from "../src/repositories/tenant-auth-repository.js";
import {
  generateApiKey,
  generateSessionToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../src/security/crypto.js";

const TENANT_DEFAULT = "11111111-1111-4111-8111-111111111111";
const TENANT_QA = "22222222-2222-4222-8222-222222222222";

// Vectores reales generados con StockAgent Python (src/auth/password.py) para "StockAgent2026!"
const PYTHON_MODERN_HASH =
  "pbkdf2:sha256:600000$ed844ba19ea23b846a5a7243ab409aad$6fa10e2ce6bbab9abcab0609c913bcc788cd94279b7aa4112369dac97eb944b9";
const PYTHON_LEGACY_HASH =
  "0123456789abcdef0123456789abcdef:8415454e8916779f8c058d90889a95a41aeaef72820a3e1ebf2593c701006920";

function createPhase4Harness() {
  const tenantsList = [
    { id: TENANT_DEFAULT, slug: "default", name: "Principal", active: true },
    { id: TENANT_QA, slug: "qa", name: "QA", active: true },
  ];

  const usersList: Array<{
    id: number;
    tenantId: string;
    username: string;
    passwordHash: string;
    role: UserRole;
    active: boolean;
    mustChangePassword: boolean;
    nombre: string;
    email: string;
    uiPreferences: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }> = [
    {
      id: 1,
      tenantId: TENANT_DEFAULT,
      username: "Auditoria",
      passwordHash: PYTHON_MODERN_HASH,
      role: "master",
      active: true,
      mustChangePassword: false,
      nombre: "Auditoría Master",
      email: "master@empresa.com",
      uiPreferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      tenantId: TENANT_DEFAULT,
      username: "operador_py",
      passwordHash: PYTHON_LEGACY_HASH,
      role: "operador",
      active: true,
      mustChangePassword: false,
      nombre: "Juan Operario",
      email: "juan@empresa.com",
      uiPreferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 3,
      tenantId: TENANT_DEFAULT,
      username: "admin_web",
      passwordHash: PYTHON_MODERN_HASH,
      role: "administrador",
      active: true,
      mustChangePassword: false,
      nombre: "Ana Admin",
      email: "ana@empresa.com",
      uiPreferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 4,
      tenantId: TENANT_DEFAULT,
      username: "consulta_user",
      passwordHash: PYTHON_MODERN_HASH,
      role: "consulta",
      active: true,
      mustChangePassword: false,
      nombre: "Solo Lectura",
      email: "",
      uiPreferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 5,
      tenantId: TENANT_QA,
      username: "op_qa",
      passwordHash: PYTHON_MODERN_HASH,
      role: "operador",
      active: true,
      mustChangePassword: false,
      nombre: "Operador QA",
      email: "",
      uiPreferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const failedByUser = new Map<string, { count: number; lockedUntil: number }>();
  const sessions = new Map<
    string,
    {
      tokenHash: string;
      tenantId: string;
      userId: number;
      username: string;
      role: UserRole;
      nombre: string;
      email: string;
      lastActive: Date;
    }
  >();
  const apiKeys = new Map<
    string,
    {
      keyHash: string;
      tenantId: string;
      clientName: string;
      role: UserRole;
      active: boolean;
      createdAt: Date;
      lastUsed: Date | null;
    }
  >();

  const products = [
    {
      id: 1,
      tenantId: TENANT_DEFAULT,
      code: "101",
      name: "Proteina Whey 1kg",
      stock: 40,
      stockMinimo: 10,
      stockMaximo: 120,
      stockFisico: 40,
      codBarras: "7791234567890",
      ubicacion: "A-01-1",
      displayOrder: 1,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      tenantId: TENANT_DEFAULT,
      code: "201",
      name: "Creatina 300g",
      stock: 15,
      stockMinimo: 5,
      stockMaximo: 80,
      stockFisico: 14,
      codBarras: "7791234567892",
      ubicacion: "B-02-3",
      displayOrder: 2,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const orders = [
    {
      id: 10,
      tenantId: TENANT_DEFAULT,
      customerId: 1,
      notaPedido: "NP-001",
      numeroPedido: "0001-00000001",
      cliente: "Distribuidora Norte",
      bultos: 2,
      logistica: "Domicilio" as const,
      armador: "Juan",
      tipoArchivo: "pdf" as const,
      nombreArchivo: "remito1.pdf",
      agregado: false,
      articulosDescontados: 5,
      resumenItems: "101 x5",
      estado: "descontado" as const,
      fechaRetiro: "2026-11-20",
      archivoDescuentoKey: "",
      cierreId: null,
      cierreMercadoId: null,
      archivoHash: "h1",
      numeroGuia: "GUIA-777",
      itemsSinCoincidencia: [],
      estadoDespacho: "armado" as "armado" | "despachado" | "entregado",
      despachadoAt: null as Date | null,
      despachadoPor: "",
      entregadoAt: null as Date | null,
      entregadoPor: "",
      canal: "mayorista" as const,
      createdAt: new Date("2026-11-20T12:00:00.000Z"),
    },
  ];
  const orderItemsData = [
    { id: 1, tenantId: TENANT_DEFAULT, orderId: 10, productId: 1, codigo: "101", descripcion: "Proteina Whey 1kg", cantidad: 5 },
  ];
  const movements: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];
  const chatMessages: Array<{
    id: number;
    tenantId: string;
    emisor: string;
    destinatario: string;
    mensaje: string;
    leido: boolean;
    createdAt: Date;
  }> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let seq = 20;

  const toSafe = (u: (typeof usersList)[number]): SafeUserRecord => {
    const { passwordHash: _omit, ...safe } = u;
    return safe;
  };

  const fakeDb = {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({ execute: async () => undefined }),
  } as unknown as Database;

  const authRepo = {
    getTenantBySlug: async (slug: string) =>
      tenantsList.find((t) => t.slug.toLowerCase() === slug.trim().toLowerCase()) ?? null,
    getTenantById: async (id: string) =>
      tenantsList.find((t) => t.id === id) ?? null,
    authenticateDetailed: async (
      scope: { tenantId: string },
      usernameOrEmail: string,
      password: string
    ): Promise<AuthDetailedResult> => {
      const iden = usernameOrEmail.trim().toLowerCase();
      const user = usersList.find(
        (u) =>
          u.tenantId === scope.tenantId &&
          (u.username.toLowerCase() === iden ||
            (u.email && u.email.toLowerCase() === iden))
      );
      const lockKey = `${scope.tenantId}:${user ? user.username.toLowerCase() : iden}`;
      const attempt = failedByUser.get(lockKey);
      if (attempt && attempt.lockedUntil > Date.now()) {
        return {
          status: "locked",
          user: null,
          retryAfterSeconds: Math.ceil((attempt.lockedUntil - Date.now()) / 1000),
          attemptsLeft: 0,
        };
      }
      if (!user || !verifyPassword(password, user.passwordHash)) {
        const nextCount = (attempt?.count ?? 0) + 1;
        const locked = nextCount >= MAX_FAILED_LOGIN_ATTEMPTS;
        failedByUser.set(lockKey, {
          count: nextCount,
          lockedUntil: locked ? Date.now() + LOCKOUT_SECONDS * 1000 : 0,
        });
        return {
          status: locked ? "locked" : "invalid",
          user: null,
          retryAfterSeconds: locked ? LOCKOUT_SECONDS : 0,
          attemptsLeft: locked ? 0 : MAX_FAILED_LOGIN_ATTEMPTS - nextCount,
        };
      }
      if (!user.active) {
        return {
          status: "inactive",
          user: toSafe(user),
          retryAfterSeconds: 0,
          attemptsLeft: null,
        };
      }
      failedByUser.delete(lockKey);
      return {
        status: "ok",
        user: toSafe(user),
        retryAfterSeconds: 0,
        attemptsLeft: null,
      };
    },
    createSession: async (scope: { tenantId: string }, user: SafeUserRecord) => {
      const rawToken = generateSessionToken();
      const tokenHash = hashToken(rawToken);
      sessions.set(tokenHash, {
        tokenHash,
        tenantId: scope.tenantId,
        userId: user.id,
        username: user.username,
        role: user.role,
        nombre: user.nombre || user.username,
        email: user.email,
        lastActive: new Date(),
      });
      return rawToken;
    },
    resolveSessionByToken: async (rawToken: string) => {
      const s = sessions.get(hashToken(rawToken));
      if (!s) return null;
      return s;
    },
    revokeSessionByToken: async (rawToken: string) =>
      sessions.delete(hashToken(rawToken)),
    countActiveSessions: async (scope: { tenantId: string }) =>
      Array.from(sessions.values()).filter((s) => s.tenantId === scope.tenantId)
        .length,
    listUsers: async (scope: { tenantId: string }, includeMaster = true) =>
      usersList
        .filter(
          (u) =>
            u.tenantId === scope.tenantId &&
            (includeMaster || u.role !== "master")
        )
        .map(toSafe),
    createUser: async (
      scope: { tenantId: string },
      input: {
        username: string;
        password: string;
        role: UserRole;
        creatorRole?: UserRole;
        nombre?: string;
        email?: string;
        mustChangePassword?: boolean;
      }
    ) => {
      if (
        (input.role === "master" || input.role === "administrador") &&
        input.creatorRole &&
        input.creatorRole !== "master"
      ) {
        throw new ForbiddenError("SoD: solo master puede crear admins/masters.");
      }
      const pwdHash = hashPassword(input.password);
      const created = {
        id: ++seq,
        tenantId: scope.tenantId,
        username: input.username,
        passwordHash: pwdHash,
        role: input.role,
        active: true,
        mustChangePassword: input.mustChangePassword ?? false,
        nombre: input.nombre ?? "",
        email: input.email ?? "",
        uiPreferences: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      usersList.push(created);
      return toSafe(created);
    },
    createTenantApiKey: async (
      scope: { tenantId: string },
      clientName: string,
      role: UserRole
    ) => {
      const { rawKey, keyHash } = generateApiKey();
      apiKeys.set(keyHash, {
        keyHash,
        tenantId: scope.tenantId,
        clientName,
        role,
        active: true,
        createdAt: new Date(),
        lastUsed: null,
      });
      return { rawKey, keyHash };
    },
    listApiKeys: async (scope: { tenantId: string }) =>
      Array.from(apiKeys.values()).filter((k) => k.tenantId === scope.tenantId),
    revokeApiKey: async (scope: { tenantId: string }, keyHash: string) => {
      const k = apiKeys.get(keyHash);
      if (!k || k.tenantId !== scope.tenantId) {
        throw new NotFoundError("Clave API no encontrada.");
      }
      k.active = false;
      return true;
    },
    validateApiKey: async (rawKey: string) => {
      const k = apiKeys.get(hashToken(rawKey));
      if (!k || !k.active) return null;
      return k;
    },
  } as unknown as TenantAuthRepository;

  const authResolver: AuthResolver = async (request) => {
    const apiKeyHdr = request.headers["x-api-key"];
    const apiKey = typeof apiKeyHdr === "string" ? apiKeyHdr.trim() : "";
    if (apiKey) {
      const row = await authRepo.validateApiKey(apiKey);
      if (!row) return null;
      return {
        tenantId: row.tenantId,
        userId: 0,
        username: `api:${row.clientName}`,
        role: row.role,
        authType: "api_key",
        nombre: `API (${row.clientName})`,
        email: "",
      };
    }

    const authHdr = request.headers.authorization;
    const xToken = request.headers["x-auth-token"];
    const token =
      typeof authHdr === "string" && /^Bearer\s+/i.test(authHdr)
        ? authHdr.replace(/^Bearer\s+/i, "").trim()
        : typeof xToken === "string"
          ? xToken.trim()
          : "";
    if (!token) return null;
    const session = await authRepo.resolveSessionByToken(token);
    if (!session) return null;
    return {
      tenantId: session.tenantId,
      userId: session.userId,
      username: session.username,
      role: session.role,
      authType: "session",
      nombre: session.nombre,
      email: session.email,
    };
  };

  const productRepo = {
    listProducts: async (scope: { tenantId: string }) =>
      products.filter((p) => p.tenantId === scope.tenantId && p.active),
    searchProducts: async (
      scope: { tenantId: string },
      term: string,
      limit = 50
    ) => {
      const q = term.trim().toLowerCase();
      return products
        .filter(
          (p) =>
            p.tenantId === scope.tenantId &&
            p.active &&
            (p.code.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q) ||
              p.codBarras.toLowerCase().includes(q))
        )
        .slice(0, limit);
    },
    findProductByCodeOrBarcode: async (
      scope: { tenantId: string },
      rawQuery: string
    ) => {
      const variants = generarVariantesCodigoLector(rawQuery);
      if (variants.length === 0) return null;
      const activeRows = products.filter(
        (p) => p.tenantId === scope.tenantId && p.active
      );
      for (const v of variants) {
        const hit = activeRows.find(
          (p) =>
            p.code.toLowerCase() === v.toLowerCase() ||
            p.codBarras.toLowerCase() === v.toLowerCase()
        );
        if (hit) return hit;
      }
      return activeRows.find((p) => coincideCodigoOBarras(p, rawQuery)) ?? null;
    },
    updateLocation: async (
      scope: { tenantId: string },
      code: string,
      ubicacion: string
    ) => {
      const prod = products.find(
        (p) =>
          p.tenantId === scope.tenantId &&
          p.code.toLowerCase() === normalizarCodigo(code).toLowerCase()
      );
      if (!prod) throw new NotFoundError(`Producto '${code}' no encontrado.`);
      prod.ubicacion = ubicacion.trim().toUpperCase();
      return prod;
    },
    setBarcode: async (
      scope: { tenantId: string },
      code: string,
      codBarras: string
    ) => {
      const prod = products.find(
        (p) =>
          p.tenantId === scope.tenantId &&
          p.code.toLowerCase() === normalizarCodigo(code).toLowerCase()
      );
      if (!prod) throw new NotFoundError(`Producto '${code}' no encontrado.`);
      prod.codBarras = codBarras.trim();
      return prod;
    },
    adjustStockAtomic: async (
      scope: { tenantId: string },
      input: { codigo: string; delta: number; movementType: string }
    ) => {
      const prod = products.find(
        (p) =>
          p.tenantId === scope.tenantId &&
          p.code.toLowerCase() === normalizarCodigo(input.codigo).toLowerCase()
      );
      if (!prod) throw new NotFoundError(`Producto '${input.codigo}' no encontrado.`);
      const stockAnterior = prod.stock;
      prod.stock += input.delta;
      movements.push({
        tenantId: scope.tenantId,
        code: prod.code,
        delta: input.delta,
        type: input.movementType,
      });
      return { product: prod, stockAnterior, stockNuevo: prod.stock };
    },
    recordPhysicalInventory: async (
      scope: { tenantId: string },
      input: { conteo: Record<string, number> }
    ) => {
      const catalog = products.filter(
        (p) => p.tenantId === scope.tenantId && p.active
      );
      const items = Object.entries(input.conteo).map(([raw, qty]) => {
        const prod = catalog.find((p) => coincideCodigoOBarras(p, raw));
        const stockFisico = Math.max(0, Math.trunc(qty));
        if (!prod) {
          return {
            productId: null,
            codigo: raw,
            nombre: "Producto no catalogado",
            stockDigital: 0,
            stockFisico,
            diferencia: stockFisico,
            estado: "NO_CATALOGADO",
          };
        }
        prod.stockFisico = stockFisico;
        const diferencia = stockFisico - prod.stock;
        const estado =
          diferencia === 0
            ? "COINCIDE"
            : diferencia < 0
              ? "FALTANTE"
              : "SOBRANTE";
        return {
          productId: prod.id,
          codigo: prod.code,
          nombre: prod.name,
          stockDigital: prod.stock,
          stockFisico,
          diferencia,
          estado,
        };
      });
      return {
        inventoryId: ++seq,
        items,
        totalDiferencias: items.filter((i) => i.diferencia !== 0).length,
      };
    },
    listRecentMovements: async (scope: { tenantId: string }) =>
      movements.filter((m) => m.tenantId === scope.tenantId),
    getReplenishmentAnalysis: async () => [],
    listAdminNotifications: async (scope: { tenantId: string }) =>
      notifications.filter((n) => n.tenantId === scope.tenantId),
    markNotificationsRead: async () => undefined,
  } as unknown as ProductRepository;

  const orderRepo = {
    advanceDispatchState: async (
      scope: { tenantId: string },
      input: {
        codigoQrORemito: string;
        usuario: string;
        nuevoEstado?: "armado" | "despachado" | "entregado";
      }
    ) => {
      let ref = input.codigoQrORemito.trim();
      if (ref.toUpperCase().startsWith("REMITO:")) {
        ref = (ref.split("|")[0] ?? ref).slice("REMITO:".length).trim();
      }
      const order = orders.find(
        (o) =>
          o.tenantId === scope.tenantId &&
          (o.notaPedido.toLowerCase() === ref.toLowerCase() ||
            o.numeroGuia.toLowerCase() === ref.toLowerCase())
      );
      if (!order) {
        return {
          ok: false,
          mensaje: `No se encontró ningún pedido con el código '${ref}'.`,
          order: null,
        };
      }
      const target =
        input.nuevoEstado ??
        (order.estadoDespacho === "armado" ? "despachado" : "entregado");
      order.estadoDespacho = target;
      if (target === "despachado") {
        order.despachadoAt = new Date();
        order.despachadoPor = input.usuario;
      } else if (target === "entregado") {
        order.entregadoAt = new Date();
        order.entregadoPor = input.usuario;
      }
      return {
        ok: true,
        mensaje: `Pedido ${order.notaPedido} actualizado a '${target.toUpperCase()}'.`,
        order,
      };
    },
    getOrderWithItems: async (
      scope: { tenantId: string },
      notaPedido: string
    ) => {
      const order = orders.find(
        (o) =>
          o.tenantId === scope.tenantId &&
          o.notaPedido.toLowerCase() === notaPedido.trim().toLowerCase()
      );
      if (!order) return null;
      return {
        order,
        items: orderItemsData.filter((i) => i.orderId === order.id),
      };
    },
    listOrdersWithItems: async (
      scope: { tenantId: string },
      opts: { estadoDespacho?: string; limit?: number } = {}
    ) =>
      orders
        .filter(
          (o) =>
            o.tenantId === scope.tenantId &&
            (!opts.estadoDespacho || o.estadoDespacho === opts.estadoDespacho)
        )
        .slice(0, opts.limit ?? 50)
        .map((order) => ({
          order,
          items: orderItemsData.filter((i) => i.orderId === order.id),
        })),
    acquireOrderLock: async () => ({ acquired: true, lockedBy: "op" }),
    releaseOrderLock: async () => undefined,
  } as unknown as OrderRepository;

  const auditRepo = {
    logAudit: async (
      scope: { tenantId: string },
      usuario: string,
      accion: string,
      detalle: string
    ) => {
      auditLogs.push({ tenantId: scope.tenantId, usuario, accion, detalle });
      return null;
    },
    listAuditLogs: async (scope: { tenantId: string }) =>
      auditLogs.filter((l) => l.tenantId === scope.tenantId),
    sendChatMessage: async (
      scope: { tenantId: string },
      input: { emisor: string; destinatario?: string; mensaje: string }
    ) => {
      const row = {
        id: ++seq,
        tenantId: scope.tenantId,
        emisor: input.emisor,
        destinatario: input.destinatario ?? "Todos",
        mensaje: input.mensaje,
        leido: false,
        createdAt: new Date(),
      };
      chatMessages.push(row);
      return row;
    },
    listChatMessages: async (scope: { tenantId: string }) =>
      chatMessages.filter((m) => m.tenantId === scope.tenantId),
    markChatMessagesRead: async () => undefined,
  } as unknown as AuditChatRepository;

  const eventBus = new InMemoryEventBus();
  const queue = new InMemoryQueueAdapter();

  const app = createApp({
    db: fakeDb,
    authResolver,
    authRepo,
    productRepo,
    orderRepo,
    auditRepo,
    eventBus,
    queue,
    logger: false,
  });

  return { app, eventBus, queue, products, orders, usersList };
}

describe("Fase 4 - Autenticación, hashes Python 600k, RBAC y Sistema Mobile", () => {
  it("sistema/ping y sistema/estado cumplen el contrato Flutter con y sin auth", async () => {
    const { app } = createPhase4Harness();
    try {
      const ping = await app.inject({ method: "GET", url: "/api/v1/sistema/ping" });
      expect(ping.statusCode).toBe(200);
      expect(ping.json().status).toBe("pong");

      const estadoAnon = await app.inject({ method: "GET", url: "/api/v1/sistema/estado" });
      expect(estadoAnon.statusCode).toBe(200);
      expect(estadoAnon.json()).toMatchObject({
        ok: true,
        sesiones_activas: 0,
        modo_conexion: "",
      });

      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "operador_py", password: "StockAgent2026!" },
      });
      expect(login.statusCode).toBe(200);
      const token = login.json().token as string;

      const estadoAuth = await app.inject({
        method: "GET",
        url: "/api/v1/sistema/estado",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(estadoAuth.statusCode).toBe(200);
      expect(estadoAuth.json()).toMatchObject({
        ok: true,
        sesiones_activas: 1,
        queue_driver: "memory",
        event_bus_driver: "memory",
      });
    } finally {
      await app.close();
    }
  });

  it("login valida hashes Python PBKDF2 600k (moderno y heredado), lockout 423, rate limit 429 y logout", async () => {
    const { app } = createPhase4Harness();
    try {
      // Login sin tenantSlug (modo Flutter -> tenant 'default') con hash legacy salt:hex
      const legacyLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "operador_py", password: "StockAgent2026!" },
      });
      expect(legacyLogin.statusCode).toBe(200);
      expect(legacyLogin.json().user).toMatchObject({
        id: 2,
        username: "operador_py",
        role: "operador",
        nombre: "Juan Operario",
      });

      const token = legacyLogin.json().token as string;
      const me = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().username).toBe("operador_py");

      await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: { authorization: `Bearer ${token}` },
      });
      const meAfterLogout = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(meAfterLogout.statusCode).toBe(401);

      // Multi-tenant login con tenantSlug 'qa' + hash moderno pbkdf2:sha256:600000$
      const qaLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          username: "op_qa",
          password: "StockAgent2026!",
          tenantSlug: "qa",
        },
      });
      expect(qaLogin.statusCode).toBe(200);
      expect(qaLogin.json().user.tenant_id).toBe(TENANT_QA);

      // Lockout tras 5 fallos (devuelve 423 con campo top-level detail para Flutter)
      for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) {
        const failRes = await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { username: "consulta_user", password: "WrongPassword1!" },
        });
        if (i === MAX_FAILED_LOGIN_ATTEMPTS - 1) {
          expect(failRes.statusCode).toBe(423);
          expect(String(failRes.json().detail)).toContain("bloqueado");
        } else {
          expect(failRes.statusCode).toBe(401);
        }
      }

      // Rate limit por IP al superar 10 intentos en 60s
      let got429 = false;
      for (let i = 0; i < 6; i += 1) {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { username: "otro_user", password: "WrongPassword1!" },
        });
        if (res.statusCode === 429) {
          got429 = true;
          break;
        }
      }
      expect(got429).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("aplica separación de funciones (SoD) y API Keys exclusivas de Master", async () => {
    const { app } = createPhase4Harness();
    try {
      const masterLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "Auditoria", password: "StockAgent2026!" },
      });
      const masterToken = masterLogin.json().token as string;

      const adminLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "admin_web", password: "StockAgent2026!" },
      });
      const adminToken = adminLogin.json().token as string;

      // Admin no puede crear otro admin (SoD -> 403), ni emitir API Key (solo Master -> 403)
      const adminCreateAdmin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/users",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          username: "nuevo_admin",
          password: "ClaveSegura2026!",
          role: "administrador",
        },
      });
      expect(adminCreateAdmin.statusCode).toBe(403);

      const adminCreateKey = await app.inject({
        method: "POST",
        url: "/api/v1/auth/api-keys",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { client_name: "ERP" },
      });
      expect(adminCreateKey.statusCode).toBe(403);

      // Master emite API key y el ERP la usa en /api/v1/productos/:codigo/stock
      const createKey = await app.inject({
        method: "POST",
        url: "/api/v1/auth/api-keys",
        headers: { authorization: `Bearer ${masterToken}` },
        payload: { client_name: "ERP-Contable", role: "consulta" },
      });
      expect(createKey.statusCode).toBe(201);
      const rawKey = createKey.json().api_key as string;
      const keyHash = createKey.json().key_hash as string;
      expect(rawKey.startsWith("sk_live_")).toBe(true);

      const stockByKey = await app.inject({
        method: "GET",
        url: "/api/v1/productos/101/stock",
        headers: { "x-api-key": rawKey },
      });
      expect(stockByKey.statusCode).toBe(200);
      expect(stockByKey.json()).toMatchObject({
        ok: true,
        code: "101",
        stock: 40,
      });

      // Clave con rol 'consulta' bloqueada para modificar ubicación (403)
      const mutByReadKey = await app.inject({
        method: "PUT",
        url: "/api/v1/productos/101/ubicacion",
        headers: { "x-api-key": rawKey },
        payload: { ubicacion: "C-99" },
      });
      expect(mutByReadKey.statusCode).toBe(403);

      await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/api-keys/${keyHash}`,
        headers: { authorization: `Bearer ${masterToken}` },
      });
      const stockAfterRevoke = await app.inject({
        method: "GET",
        url: "/api/v1/productos/101/stock",
        headers: { "x-api-key": rawKey },
      });
      expect(stockAfterRevoke.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe("Fase 4 - Endpoints Productos, Inventario Físico y Despacho QR/Lote Mobile", () => {
  it("productos, inventario preliminar/finalizar y despacho QR + escanear-lote cumplen contratos Flutter", async () => {
    const { app, eventBus, queue, products } = createPhase4Harness();
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "operador_py", password: "StockAgent2026!" },
      });
      const token = login.json().token as string;
      const headers = { authorization: `Bearer ${token}` };

      // 1. Buscar producto y consultar por lector EAN-13 variante UPC-A
      const search = await app.inject({
        method: "GET",
        url: "/api/v1/productos/buscar?q=Whey&limit=10",
        headers,
      });
      expect(search.statusCode).toBe(200);
      expect(search.json().total).toBe(1);
      expect(search.json().productos[0]).toMatchObject({
        code: "101",
        stock: 40,
        ubicacion: "A-01-1",
      });

      const byBarcode = await app.inject({
        method: "GET",
        url: "/api/v1/productos/07791234567890",
        headers,
      });
      expect(byBarcode.statusCode).toBe(200);
      expect(byBarcode.json().code).toBe("101");

      // 2. Actualizar ubicación y barcode (emite eventos PRODUCT_UPDATED)
      const locRes = await app.inject({
        method: "PUT",
        url: "/api/v1/productos/101/ubicacion",
        headers,
        payload: { ubicacion: "d-04-2" },
      });
      expect(locRes.statusCode).toBe(200);
      expect(locRes.json().ubicacion).toBe("D-04-2");

      const bcRes = await app.inject({
        method: "PUT",
        url: "/api/v1/productos/201/codigo-barras",
        headers,
        payload: { cod_barras: "7799999999999" },
      });
      expect(bcRes.statusCode).toBe(200);
      expect(products[1]?.codBarras).toBe("7799999999999");

      // 3. Inventario en vivo: comparar preliminar + finalizar
      const prelim = await app.inject({
        method: "POST",
        url: "/api/v1/inventario/comparar-preliminar",
        headers,
        payload: { conteo: { "101": 40, "201": 12, "999": 3 } },
      });
      expect(prelim.statusCode).toBe(200);
      expect(prelim.json()).toMatchObject({
        total_items: 3,
        coinciden: 1,
        faltantes: 1,
        sobrantes: 0,
      });

      let queuedReports = 0;
      await queue.registerWorker("inventory_reports", async () => {
        queuedReports += 1;
      });

      const fin = await app.inject({
        method: "POST",
        url: "/api/v1/inventario/finalizar",
        headers,
        payload: { conteo: { "101": 39, "201": 15 } },
      });
      expect(fin.statusCode).toBe(200);
      expect(fin.json()).toMatchObject({
        ok: true,
        total_items: 2,
        coinciden: 1,
        faltantes: 1,
        sobrantes: 0,
      });
      await queue.waitForIdle("inventory_reports");
      expect(queuedReports).toBe(1);
      expect(await queue.getStats("inventory_reports")).toMatchObject({
        completed: 1,
        failed: 0,
      });

      // 4. Despacho QR online y lote offline
      const scan1 = await app.inject({
        method: "POST",
        url: "/api/v1/despacho/escanear",
        headers,
        payload: { codigo: "REMITO:NP-001|BULTO:1/2" },
      });
      expect(scan1.statusCode).toBe(200);
      expect(scan1.json().ok).toBe(true);
      expect(scan1.json().pedido).toMatchObject({
        id: 10,
        nota_pedido: "NP-001",
        estado_despacho: "despachado",
        items: [{ codigo: "101", descripcion: "Proteina Whey 1kg", cantidad: 5 }],
      });

      const batchScan = await app.inject({
        method: "POST",
        url: "/api/v1/despacho/escanear-lote",
        headers,
        payload: {
          items: [
            { codigo: "GUIA-777", nuevo_estado: "entregado" },
            { codigo: "NP-INEXISTENTE" },
          ],
        },
      });
      expect(batchScan.statusCode).toBe(200);
      expect(batchScan.json()).toMatchObject({
        ok: true,
        total_procesados: 2,
        exitosos: 1,
        fallidos: 1,
      });

      const listDesp = await app.inject({
        method: "GET",
        url: "/api/v1/despacho/pedidos?estado_despacho=entregado",
        headers,
      });
      expect(listDesp.statusCode).toBe(200);
      expect(listDesp.json().total).toBe(1);
      expect(eventBus.getPublishedEvents(TENANT_DEFAULT).length).toBeGreaterThanOrEqual(4);
    } finally {
      await app.close();
    }
  });
});

describe("Fase 4 - Colas intercambiables (Memory / BullMQ-Redis) y WebSockets multi-tenant", () => {
  it("InMemoryQueueAdapter reintenta trabajos fallidos y reporta métricas", async () => {
    const q = new InMemoryQueueAdapter();
    let attemptsSeen = 0;

    await q.registerWorker<{ sku: string }>("sync_jobs", async () => {
      attemptsSeen += 1;
      if (attemptsSeen < 2) {
        throw new Error("Fallo transitorio simulado");
      }
    });

    await q.enqueue("sync_jobs", {
      name: "retry_test",
      tenantId: TENANT_DEFAULT,
      data: { sku: "101" },
      attempts: 3,
      backoffMs: 5,
    });

    await q.waitForIdle("sync_jobs");
    expect(attemptsSeen).toBe(2);
    expect(await q.getStats("sync_jobs")).toEqual({
      waiting: 0,
      completed: 1,
      failed: 0,
    });
    await q.close();
  });

  it("factory de adaptadores soporta Memory vs BullMQ/Redis y valida REDIS_URL", async () => {
    const baseCfg = loadAppConfig();
    expect(() =>
      createQueueAdapter({ ...baseCfg, queueDriver: "bullmq", redisUrl: "" })
    ).toThrow(/REDIS_URL/);
    expect(() =>
      createEventBusAdapter({ ...baseCfg, eventBusDriver: "redis", redisUrl: "" })
    ).toThrow(/REDIS_URL/);

    const bullQ = createQueueAdapter({
      ...baseCfg,
      queueDriver: "bullmq",
      redisUrl: "redis://127.0.0.1:6379",
    });
    const redisBus = createEventBusAdapter({
      ...baseCfg,
      eventBusDriver: "redis",
      redisUrl: "redis://127.0.0.1:6379",
    });
    expect(bullQ.driver).toBe("bullmq");
    expect(redisBus.driver).toBe("redis");
    await Promise.allSettled([bullQ.close(), redisBus.close()]);
  });

  it("WebSocket /api/v1/ws rechaza sin token y aísla eventos por tenant en tiempo real", async () => {
    const { app } = createPhase4Harness();
    try {
      const loginA = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "operador_py", password: "StockAgent2026!" },
      });
      const tokenA = loginA.json().token as string;

      const loginB = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          username: "op_qa",
          password: "StockAgent2026!",
          tenantSlug: "qa",
        },
      });
      const tokenB = loginB.json().token as string;

      // Conexión sin token debe cerrarse con código 1008
      const unauthWs = await app.injectWS("/api/v1/ws");
      const closeCode = await new Promise<number>((resolve) => {
        unauthWs.once("close", (code) => resolve(code));
      });
      expect(closeCode).toBe(1008);

      // Conectar cliente A (tenant default) y cliente B (tenant qa)
      const wsA = await app.injectWS(`/api/v1/ws?token=${encodeURIComponent(tokenA)}`);
      const wsB = await app.injectWS(`/api/v1/ws?token=${encodeURIComponent(tokenB)}`);

      const msgsA: Array<Record<string, unknown>> = [];
      const msgsB: Array<Record<string, unknown>> = [];

      wsA.on("message", (raw) => {
        msgsA.push(JSON.parse(raw.toString("utf8")) as Record<string, unknown>);
      });
      wsB.on("message", (raw) => {
        msgsB.push(JSON.parse(raw.toString("utf8")) as Record<string, unknown>);
      });

      // Ping/Pong WebSocket
      wsA.send(JSON.stringify({ type: "ping" }));

      // Acción mutadora en Tenant A (ajuste de stock) debe llegar SOLO a wsA
      const adj = await app.inject({
        method: "POST",
        url: "/api/v1/productos/101/ajustar",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { delta: 5, movement_type: "ingreso_rapido", detalle: "Test WS" },
      });
      expect(adj.statusCode).toBe(200);

      await new Promise((r) => setTimeout(r, 60));

      expect(msgsA.some((m) => m.event === "pong")).toBe(true);
      const stockEvA = msgsA.find(
        (m) => m.event === "domain_event" && m.type === "STOCK_UPDATED"
      );
      expect(stockEvA).toBeTruthy();
      expect(stockEvA?.tenantId).toBe(TENANT_DEFAULT);

      // Tenant B nunca recibió el evento de Tenant A
      expect(
        msgsB.some(
          (m) => m.event === "domain_event" && m.type === "STOCK_UPDATED"
        )
      ).toBe(false);

      wsA.close();
      wsB.close();
    } finally {
      await app.close();
    }
  });

  it("permite preflight CORS para orígenes web configurados", async () => {
    const { app } = createPhase4Harness();
    try {
      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/api/v1/health",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe(
        "http://127.0.0.1:5173"
      );
    } finally {
      await app.close();
    }
  });
});

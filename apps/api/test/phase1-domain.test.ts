import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  clasificarCanalPedido,
  coincideCodigoOBarras,
  CustomerSchema,
  generarVariantesCodigoLector,
  normalizarCodigo,
  normalizarCodigoLector,
  OrderSchema,
  PASSWORD_ITERATIONS,
  PASSWORD_MIN_LENGTH,
  ProductSchema,
  TenantSchema,
  UserSchema,
} from "@stockagent/shared";
import { assertValidTenantId } from "../src/db/client.js";
import { TENANT_STRICT_RLS_TABLES } from "../src/db/rls.js";
import * as schema from "../src/db/schema/index.js";
import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
  generateSessionToken,
  hashPassword,
  hashSha256,
  hashToken,
  isEncryptedSecret,
  validatePasswordPolicy,
  verifyPassword,
} from "../src/security/crypto.js";

describe("Fase 1 - Dominio compartido y normalización", () => {
  it("normalizarCodigo limpia espacios y sufijos .0", () => {
    expect(normalizarCodigo("  1045.0  ")).toBe("1045");
    expect(normalizarCodigo(1045.0)).toBe("1045");
    expect(normalizarCodigo("00123.00")).toBe("00123");
    expect(normalizarCodigo(null)).toBe("");
    expect(normalizarCodigo(undefined)).toBe("");
    expect(normalizarCodigo(true)).toBe("");
    expect(normalizarCodigo(Number.NaN)).toBe("");
  });

  it("normalizarCodigoLector limpia AIM, caracteres de control y delimitadores Code-39", () => {
    expect(normalizarCodigoLector("]C1*7791234567890*")).toBe("7791234567890");
    expect(normalizarCodigoLector("]e0  1045.0 \u001d")).toBe("1045");
    expect(normalizarCodigoLector("\u0002  SKU-100 \u001d")).toBe("SKU-100");
    expect(normalizarCodigoLector("*123*")).toBe("123");
  });

  it("generarVariantesCodigoLector y coincideCodigoOBarras cubren HID ES/LA y EAN-13/UPC-A", () => {
    const variantesTeclado = generarVariantesCodigoLector("SKU'100?A");
    expect(variantesTeclado).toContain("SKU-100_A");

    const variantesUpc = generarVariantesCodigoLector("0123456789012");
    expect(variantesUpc).toContain("123456789012");

    expect(
      coincideCodigoOBarras(
        { code: "SKU-100_A", codBarras: "0779123456789" },
        "}C1SKU'100?A"
      )
    ).toBe(true);
    expect(
      coincideCodigoOBarras(
        { code: "101", cod_barras: "779123456789" },
        "0779123456789"
      )
    ).toBe(true);
    expect(
      coincideCodigoOBarras({ code: "101", codBarras: "779123456789" }, "999999")
    ).toBe(false);
  });

  it("clasificarCanalPedido aplica las reglas determinísticas de canal", () => {
    expect(
      clasificarCanalPedido({
        canalExplicito: "FULL",
        tipoArchivo: "pdf",
      })
    ).toBe("full");

    expect(
      clasificarCanalPedido({
        tipoArchivo: "excel",
        nombreArchivo: "envio_full_abril.xlsx",
      })
    ).toBe("full");

    expect(
      clasificarCanalPedido({
        tipoArchivo: "docx",
        cliente: "Comprador ML",
      })
    ).toBe("mercado_libre");

    expect(
      clasificarCanalPedido({
        tipoArchivo: "excel",
        logistica: "Canje",
      })
    ).toBe("canje");

    expect(
      clasificarCanalPedido({
        tipoArchivo: "pdf",
        cliente: "Distribuidora Norte",
      })
    ).toBe("mayorista");

    expect(clasificarCanalPedido({})).toBe("otro");
  });

  it("valida contratos Zod base de Tenant, User, Product, Customer y Order", () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const now = "2026-11-17T00:00:00.000Z";

    expect(
      TenantSchema.parse({
        id: tenantId,
        slug: "default",
        name: "Principal",
        plan: "enterprise",
        active: true,
        createdAt: now,
        updatedAt: now,
      }).slug
    ).toBe("default");

    expect(
      UserSchema.parse({
        id: 1,
        tenantId,
        username: "Auditoria",
        role: "master",
        active: true,
        mustChangePassword: false,
        nombre: "Auditoría",
        email: "auditoria@example.com",
        createdAt: now,
        updatedAt: now,
      }).id
    ).toBe(1);

    expect(
      ProductSchema.parse({
        id: 10,
        tenantId,
        code: "101",
        name: "Producto Demo",
        stock: 25,
        stockMinimo: 5,
        stockMaximo: 100,
        stockFisico: null,
        codBarras: "7791234567890",
        ubicacion: "A1",
        displayOrder: 1,
        active: true,
        createdAt: now,
        updatedAt: now,
      }).code
    ).toBe("101");

    expect(
      CustomerSchema.parse({
        id: 3,
        tenantId,
        nombre: "Cliente SA",
        codigo: "CLI-000003",
        direccion: "Av. Siempre Viva 742",
        activo: true,
        createdAt: now,
      }).codigo
    ).toBe("CLI-000003");

    expect(
      OrderSchema.parse({
        id: 7,
        tenantId,
        notaPedido: "NP-001",
        numeroPedido: "0001",
        cliente: "Cliente SA",
        bultos: 2,
        logistica: "Domicilio",
        armador: "Juan",
        tipoArchivo: "pdf",
        nombreArchivo: "remito.pdf",
        agregado: false,
        articulosDescontados: 4,
        resumenItems: "101 x4",
        estado: "descontado",
        fechaRetiro: "2026-11-17",
        archivoDescuento: "",
        cierreId: null,
        cierreMercadoId: null,
        archivoHash: "abc",
        numeroGuia: "",
        estadoDespacho: "armado",
        despachadoAt: "",
        despachadoPor: "",
        entregadoAt: "",
        entregadoPor: "",
        canal: "mayorista",
        createdAt: now,
      }).canal
    ).toBe("mayorista");

    expect(() =>
      ProductSchema.parse({
        id: 1,
        tenantId: "no-es-uuid",
        code: "101",
        name: "X",
        stock: 0,
        stockMinimo: -1,
        stockMaximo: 10,
        stockFisico: null,
        codBarras: "",
        ubicacion: "",
        displayOrder: 0,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
    ).toThrow();
  });
});

describe("Fase 1 - Criptografía y compatibilidad Python", () => {
  it("aplica política de longitud mínima y hace round-trip PBKDF2-HMAC-SHA256", () => {
    expect(() => validatePasswordPolicy("corta")).toThrow();
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_ITERATIONS).toBe(600_000);

    const hashed = hashPassword("ClaveSegura2026!");
    expect(hashed).toMatch(/^pbkdf2:sha256:600000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(verifyPassword("ClaveSegura2026!", hashed)).toBe(true);
    expect(verifyPassword("ClaveIncorrecta!", hashed)).toBe(false);
    expect(verifyPassword("ClaveSegura2026!", "formato_invalido")).toBe(false);
  });

  it("verifica hashes generados por StockAgent Python (moderno y heredado)", () => {
    const pyModernHash =
      "pbkdf2:sha256:600000$ed844ba19ea23b846a5a7243ab409aad$6fa10e2ce6bbab9abcab0609c913bcc788cd94279b7aa4112369dac97eb944b9";
    const pyLegacyHash =
      "0123456789abcdef0123456789abcdef:8415454e8916779f8c058d90889a95a41aeaef72820a3e1ebf2593c701006920";

    expect(verifyPassword("StockAgent2026!", pyModernHash)).toBe(true);
    expect(verifyPassword("StockAgent2026!", pyLegacyHash)).toBe(true);
    expect(verifyPassword("WrongPassword1!", pyModernHash)).toBe(false);
    expect(verifyPassword("WrongPassword1!", pyLegacyHash)).toBe(false);
  });

  it("cifra y descifra secretos con AES-256-GCM y rechaza manipulación", () => {
    const masterKey = "super-secret-master-key-for-tests-32b";
    const token = "APP_USR-1234567890-token-secreto";

    const enc1 = encryptSecret(token, masterKey);
    const enc2 = encryptSecret(token, masterKey);
    expect(isEncryptedSecret(enc1)).toBe(true);
    expect(enc1).not.toBe(enc2);
    expect(decryptSecret(enc1, masterKey)).toBe(token);
    expect(decryptSecret(enc2, masterKey)).toBe(token);
    expect(decryptSecret("texto-plano", masterKey)).toBe("texto-plano");
    expect(() => decryptSecret(enc1, "otra-clave-distinta")).toThrow();

    const tampered = `${enc1.slice(0, -2)}AA`;
    expect(() => decryptSecret(tampered, masterKey)).toThrow();
  });

  it("genera hashes SHA-256, tokens de sesión y API keys sk_live_", () => {
    expect(hashSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    const session = generateSessionToken();
    expect(session.length).toBeGreaterThanOrEqual(32);
    expect(hashToken(`  ${session}  `)).toBe(hashSha256(session));

    const { rawKey, keyHash } = generateApiKey();
    expect(rawKey.startsWith("sk_live_")).toBe(true);
    expect(keyHash).toBe(hashToken(rawKey));
  });
});

describe("Fase 1 - Aislamiento multi-tenant y cobertura de esquema RLS", () => {
  it("valida UUIDs de tenant estrictamente", () => {
    const valid = "  11111111-1111-4111-8111-111111111111  ";
    expect(assertValidTenantId(valid)).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(() => assertValidTenantId("")).toThrow();
    expect(() => assertValidTenantId("default")).toThrow();
    expect(() => assertValidTenantId("123")).toThrow();
    expect(() =>
      assertValidTenantId("11111111-1111-4111-8111-111111111111' OR '1'='1")
    ).toThrow();
  });

  it("mantiene alineadas todas las tablas Drizzle del esquema con la política RLS", () => {
    const schemaTableNames = new Set<string>();
    for (const value of Object.values(schema)) {
      if (isTable(value)) {
        schemaTableNames.add(getTableName(value));
      }
    }

    const expectedCovered = new Set<string>([
      "tenants",
      "api_sessions",
      "api_keys",
      ...TENANT_STRICT_RLS_TABLES,
    ]);

    expect([...schemaTableNames].sort()).toEqual([...expectedCovered].sort());
    expect(TENANT_STRICT_RLS_TABLES.length).toBe(27);
  });
});

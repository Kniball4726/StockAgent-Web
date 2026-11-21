import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsuarioResponse } from "@stockagent/shared";
import { App } from "../src/App";
import { StockAgentApiClient } from "../src/lib/api-client";
import { StockAgentRealtimeClient } from "../src/lib/realtime-ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_PUBLIC_DIR = resolve(__dirname, "../public");

function createMockRealtime() {
  const rt = new StockAgentRealtimeClient();
  vi.spyOn(rt, "connect").mockImplementation(() => undefined);
  vi.spyOn(rt, "disconnect").mockImplementation(() => undefined);
  return rt;
}

function createMockFetchHarness(roleOverride: UsuarioResponse["role"] = "operador") {
  const calls: Array<{ method: string; url: string; headers: Headers; body?: string }> = [];
  let onLineState = true;

  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => onLineState,
  });

  const user: UsuarioResponse = {
    id: 2,
    username: "juan_op",
    role: roleOverride,
    nombre: "Juan Operario",
    email: "juan@demo.com",
    tenant_id: "11111111-1111-4111-8111-111111111111",
    must_change_password: false,
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      url,
      headers,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });

    if (url.endsWith("/api/v1/auth/login")) {
      return new Response(
        JSON.stringify({
          ok: true,
          token: "session-tok-abc",
          user,
          message: "Bienvenido",
        }),
        { status: 200 }
      );
    }

    if (url.endsWith("/api/v1/auth/me")) {
      return new Response(JSON.stringify(user), { status: 200 });
    }

    if (url.endsWith("/api/v1/auth/logout")) {
      return new Response(JSON.stringify({ ok: true, message: "bye" }), {
        status: 200,
      });
    }

    if (url.includes("/api/v1/productos/buscar")) {
      return new Response(
        JSON.stringify({
          total: 1,
          productos: [
            {
              code: "101",
              name: "Proteina Whey 1kg",
              stock: 20,
              stock_fisico: 20,
              stock_minimo: 5,
              stock_maximo: 60,
              cod_barras: "7791234567890",
              ubicacion: "A-01-1",
              active: true,
            },
          ],
        }),
        { status: 200 }
      );
    }

    if (url.endsWith("/api/v1/productos/101")) {
      return new Response(
        JSON.stringify({
          code: "101",
          name: "Proteina Whey 1kg",
          stock: 20,
          stock_fisico: 20,
          stock_minimo: 5,
          stock_maximo: 60,
          cod_barras: "7791234567890",
          ubicacion: "A-01-1",
          active: true,
        }),
        { status: 200 }
      );
    }

    if (url.includes("/api/v1/productos/reposicion/analisis")) {
      return new Response(
        JSON.stringify({
          ok: true,
          total: 1,
          items: [
            {
              id: 1,
              code: "201",
              name: "Creatina 300g",
              stock: 2,
              stockMinimo: 10,
              stockMaximo: 40,
              ubicacion: "B-02-1",
              estadoInventario: "QUIEBRE_INMINENTE",
              cantidadSugeridaPedir: 38,
            },
          ],
        }),
        { status: 200 }
      );
    }

    if (url.includes("/api/v1/despacho/pedidos")) {
      return new Response(
        JSON.stringify({
          total: 1,
          pedidos: [
            {
              id: 10,
              nota_pedido: "NP-001",
              numero_pedido: "NP-001",
              cliente: "Gimnasio Sur",
              bultos: 2,
              logistica: "Domicilio",
              armador: "Juan",
              estado_despacho: "armado",
              created_at: "2026-11-20T12:00:00.000Z",
              despachado_at: "",
              despachado_por: "",
              entregado_at: "",
              entregado_por: "",
              items: [
                {
                  codigo: "101",
                  descripcion: "Proteina Whey 1kg",
                  cantidad: 4,
                },
              ],
            },
          ],
        }),
        { status: 200 }
      );
    }

    if (url.includes("/api/v1/chat/mensajes")) {
      return new Response(JSON.stringify({ ok: true, mensajes: [] }), {
        status: 200,
      });
    }

    if (url.includes("/api/v1/notificaciones")) {
      return new Response(JSON.stringify({ ok: true, notificaciones: [] }), {
        status: 200,
      });
    }

    if (url.includes("/api/v1/files")) {
      return new Response(JSON.stringify({ ok: true, files: [] }), {
        status: 200,
      });
    }

    if (url.endsWith("/api/v1/parsers/upload-and-simulate")) {
      return new Response(
        JSON.stringify({
          ok: true,
          operation: "descuento_pedidos",
          uploadedFiles: [
            {
              file: {
                id: "f-1",
                tenantId: user.tenant_id,
                category: "remito_mayorista",
                originalName: "remito_555.pdf",
                storageKey: "t/remito_555.pdf",
                mimeType: "application/pdf",
                sizeBytes: 1024,
                sha256: "abc",
                uploadedBy: "juan_op",
                createdAt: "2026-11-20T12:00:00.000Z",
              },
              duplicateOfOrder: null,
            },
          ],
          parsedDocuments: [
            {
              file: {
                id: "f-1",
                tenantId: user.tenant_id,
                category: "remito_mayorista",
                originalName: "remito_555.pdf",
                storageKey: "t/remito_555.pdf",
                mimeType: "application/pdf",
                sizeBytes: 1024,
                sha256: "abc",
                uploadedBy: "juan_op",
                createdAt: "2026-11-20T12:00:00.000Z",
              },
              parseType: "remito_mayorista",
              document: {
                sourceFileId: "f-1",
                notaPedido: "NP-555",
                numeroPedido: "NP-555",
                cliente: "Gimnasio Sur",
                bultos: 1,
                logistica: "Domicilio",
                armador: "",
                tipoArchivo: "pdf",
                nombreArchivo: "remito_555.pdf",
                fechaRetiro: "",
                archivoHash: "abc",
                numeroGuia: "",
                items: [
                  {
                    codigo: "101",
                    descripcion: "Proteina Whey 1kg",
                    cantidad: 4,
                    origenRemito: "NP-555",
                  },
                ],
              },
              warnings: [],
              stats: {},
            },
          ],
          simulation: {
            operation: "descuento_pedidos",
            readOnly: true,
            canConfirm: true,
            blockingErrors: [],
            warnings: [],
            totalDocumentos: 1,
            totalUnidades: 4,
            documentSummaries: [],
            consolidatedItems: [],
            duplicadosConsolidados: [],
            matchedItems: [
              {
                codigoSolicitado: "101",
                codigoCatalogo: "101",
                productId: 1,
                nombre: "Proteina Whey 1kg",
                stockAnterior: 20,
                delta: -4,
                stockNuevo: 16,
                stockMinimo: 5,
                ubicacion: "A-01-1",
                quiebre: false,
                stockCritico: false,
                remitosOrigen: ["NP-555"],
              },
            ],
            unmatchedItems: [],
            quiebres: [],
            criticos: [],
            duplicateNotas: [],
            duplicateHashes: [],
          },
        }),
        { status: 200 }
      );
    }

    if (url.endsWith("/api/v1/ingestion/confirm")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            txId: "tx-web-1",
            operation: "descuento_pedidos",
            idempotentReplay: false,
            ordersCreated: [{ id: 22, notaPedido: "NP-555", totalArticulos: 4 }],
            totalUnidadesAplicadas: 4,
            matchedItems: 1,
            unmatchedItems: [],
            auditDetail: "Confirmado remito NP-555 (4 u.)",
          },
        }),
        { status: 201 }
      );
    }

    if (url.endsWith("/api/v1/inventario/comparar-preliminar")) {
      return new Response(
        JSON.stringify({
          ok: true,
          mensaje: "Comparativa preliminar lista",
          total_items: 1,
          coinciden: 0,
          faltantes: 1,
          sobrantes: 0,
          archivo_generado: null,
          comparativa: [
            {
              codigo: "101",
              nombre: "Proteina Whey 1kg",
              stock_sistema: 20,
              stock_fisico: 18,
              diferencia: -2,
              estado: "FALTANTE",
            },
          ],
        }),
        { status: 200 }
      );
    }

    if (url.endsWith("/api/v1/despacho/escanear-lote")) {
      return new Response(
        JSON.stringify({
          ok: true,
          total_procesados: 1,
          exitosos: 1,
          fallidos: 0,
          resultados: [
            {
              ok: true,
              codigo: "NP-001",
              nota_pedido: "NP-001",
              estado_despacho: "despachado",
            },
          ],
        }),
        { status: 200 }
      );
    }

    if (url.endsWith("/api/v1/auth/users")) {
      return new Response(JSON.stringify({ ok: true, users: [] }), {
        status: 200,
      });
    }

    if (url.endsWith("/api/v1/saas/usage")) {
      return new Response(
        JSON.stringify({
          ok: true,
          tenant: {
            id: user.tenant_id,
            slug: "default",
            name: "Principal",
            plan: "enterprise",
            active: true,
          },
          quotas: {
            plan: "enterprise",
            maxUsers: 500,
            maxProducts: 250000,
            maxStorageBytes: 107374182400,
            allowApiKeys: true,
            allowMercadoLibre: true,
          },
          usage: {
            usersCount: 4,
            productsCount: 120,
            storageBytes: 20480,
          },
          withinLimits: true,
        }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  return {
    calls,
    fetchImpl,
    setOnline: (val: boolean) => {
      onLineState = val;
    },
  };
}

describe("Fase 5 - Experiencia Web React, Flujos Warehouse, RBAC y PWA", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("permite login multi-tenant, aplica RBAC de navegación y ejecuta flujo Subir -> Simular -> Confirmar", async () => {
    const h = createMockFetchHarness("operador");
    const api = new StockAgentApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getToken: () => {
        const raw = window.localStorage.getItem("stockagent_session_v1");
        return raw ? (JSON.parse(raw) as { token: string }).token : null;
      },
      fetchImpl: h.fetchImpl,
    });

    render(<App apiClient={api} realtimeClient={createMockRealtime()} />);

    fireEvent.change(screen.getByLabelText(/Usuario o Email/i), {
      target: { value: "juan_op" },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: "StockAgent2026!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Iniciar Sesión/i }));

    // Tablero cargado + rol 'operador' NO ve pestaña Administración
    await waitFor(() => {
      expect(screen.getByText(/Panel Operativo/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /^Administración$/i })).toBeNull();

    // Navegar a Cargar Archivos
    fireEvent.click(screen.getByRole("button", { name: /Cargar Archivos/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Cargar Archivos PC, Simulación y Confirmación/i)
      ).toBeInTheDocument();
    });

    const input = screen.getByTestId("pc-file-input") as HTMLInputElement;
    const pdfFile = new File(["%PDF-1.4 demo"], "remito_555.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [pdfFile] } });

    fireEvent.click(screen.getByRole("button", { name: /Subir y Simular/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Previsualización de Impacto/i)
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Proteina Whey 1kg")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Confirmar e Impactar Stock/i })
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Operación confirmada en PostgreSQL/i)
      ).toBeInTheDocument();
    });

    const confirmCall = h.calls.find((c) =>
      c.url.endsWith("/api/v1/ingestion/confirm")
    );
    expect(confirmCall?.headers.get("Idempotency-Key")).toBeTruthy();
  });

  it("encola escaneos QR en modo offline y los sincroniza automáticamente al volver la conexión", async () => {
    const h = createMockFetchHarness("administrador");
    const api = new StockAgentApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getToken: () => "session-tok-abc",
      fetchImpl: h.fetchImpl,
    });

    window.localStorage.setItem(
      "stockagent_session_v1",
      JSON.stringify({
        token: "session-tok-abc",
        user: {
          id: 3,
          username: "ana_admin",
          role: "administrador",
          nombre: "Ana Admin",
          email: "",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          must_change_password: false,
        },
      })
    );

    render(<App apiClient={api} realtimeClient={createMockRealtime()} />);

    // Administrador SÍ ve la pestaña Administración
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^Administración$/i })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Despacho QR/i }));
    await waitFor(() => {
      expect(screen.getByText(/Despacho QR y Cola Offline/i)).toBeInTheDocument();
    });

    // Simular corte de Wi-Fi
    h.setOnline(false);
    fireEvent(window, new Event("offline"));

    const qrField = screen.getByPlaceholderText(/Escanear QR remito/i);
    fireEvent.change(qrField, {
      target: { value: "REMITO:NP-001|BULTO:1/2" },
    });
    fireEvent.submit(qrField.closest("form")!);

    await waitFor(() => {
      expect(
        screen.getByText(/Cola Offline \(1 escaneo\/s pendiente\/s\)/i)
      ).toBeInTheDocument();
    });

    // Recuperar Wi-Fi -> debe sincronizar automáticamente via /escanear-lote
    h.setOnline(true);
    fireEvent(window, new Event("online"));

    await waitFor(() => {
      expect(
        h.calls.some((c) => c.url.endsWith("/api/v1/despacho/escanear-lote"))
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(/Cola offline sincronizada/i)).toBeInTheDocument();
    });
  });

  it("inventario en vivo permite comparar preliminar contra PostgreSQL", async () => {
    const h = createMockFetchHarness("operador");
    const api = new StockAgentApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getToken: () => "session-tok-abc",
      fetchImpl: h.fetchImpl,
    });

    window.localStorage.setItem(
      "stockagent_session_v1",
      JSON.stringify({
        token: "session-tok-abc",
        user: {
          id: 2,
          username: "juan_op",
          role: "operador",
          nombre: "Juan Operario",
          email: "",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          must_change_password: false,
        },
      })
    );

    render(<App apiClient={api} realtimeClient={createMockRealtime()} />);

    fireEvent.click(screen.getByRole("button", { name: /Inventario Físico/i }));
    await waitFor(() => {
      expect(screen.getByText(/Inventario Físico en Vivo/i)).toBeInTheDocument();
    });

    const skuInput = screen.getByPlaceholderText(/Escanear SKU o código de barras/i);
    const qtyInput = screen.getByLabelText(/Cantidad contada/i);
    fireEvent.change(skuInput, { target: { value: "101" } });
    fireEvent.change(qtyInput, { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: /Sumar/i }));

    await waitFor(() => {
      expect(screen.getByText("101")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Comparar Preliminar/i })
    );

    await waitFor(() => {
      expect(screen.getByText("FALTANTE")).toBeInTheDocument();
    });
  });

  it("exige cambio de contraseña obligatorio cuando must_change_password es true", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = input.toString();
      if (url.endsWith("/api/v1/auth/login")) {
        return new Response(
          JSON.stringify({
            ok: true,
            token: "temp-tok",
            user: {
              id: 7,
              username: "nuevo_op",
              role: "operador",
              nombre: "Nuevo Operador",
              email: "",
              tenant_id: "11111111-1111-4111-8111-111111111111",
              must_change_password: true,
            },
            message: "Debe cambiar contraseña",
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/v1/auth/change-password")) {
        return new Response(
          JSON.stringify({ ok: true, message: "Contraseña actualizada" }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true, productos: [], items: [], pedidos: [], mensajes: [] }), {
        status: 200,
      });
    };

    const api = new StockAgentApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getToken: () => "temp-tok",
      fetchImpl: mockFetch,
    });

    render(<App apiClient={api} realtimeClient={createMockRealtime()} />);

    fireEvent.change(screen.getByLabelText(/Usuario o Email/i), {
      target: { value: "nuevo_op" },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: "ClaveTemporal2026!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Iniciar Sesión/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/tu cuenta requiere actualizar la contraseña/i)
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Contraseña actual$/i), {
      target: { value: "ClaveTemporal2026!" },
    });
    fireEvent.change(screen.getByLabelText(/^Nueva contraseña$/i), {
      target: { value: "ClaveDefinitiva2026!" },
    });
    fireEvent.change(screen.getByLabelText(/Repetir nueva contraseña/i), {
      target: { value: "ClaveDefinitiva2026!" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Actualizar y Entrar/i })
    );

    await waitFor(() => {
      expect(screen.getByText(/Panel Operativo/i)).toBeInTheDocument();
    });
  });

  it("catálogo permite buscar, seleccionar producto y guardar ubicación", async () => {
    const h = createMockFetchHarness("operador");
    const baseFetch = h.fetchImpl;
    const extendedFetch: typeof fetch = async (input, init) => {
      const url = input.toString();
      if (url.endsWith("/api/v1/productos/101/ubicacion")) {
        return new Response(
          JSON.stringify({ ok: true, code: "101", ubicacion: "D-04-2" }),
          { status: 200 }
        );
      }
      return baseFetch(input, init);
    };

    const api = new StockAgentApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getToken: () => "session-tok-abc",
      fetchImpl: extendedFetch,
    });

    window.localStorage.setItem(
      "stockagent_session_v1",
      JSON.stringify({
        token: "session-tok-abc",
        user: {
          id: 2,
          username: "juan_op",
          role: "operador",
          nombre: "Juan Operario",
          email: "",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          must_change_password: false,
        },
      })
    );

    render(<App apiClient={api} realtimeClient={createMockRealtime()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Catálogo$/i }));

    await waitFor(() => {
      expect(screen.getByText("Proteina Whey 1kg")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Proteina Whey 1kg"));
    const locInput = screen.getByPlaceholderText("Ej: D-04-2");
    fireEvent.change(locInput, { target: { value: "d-04-2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Ubicación actualizada para 101: D-04-2/i)
      ).toBeInTheDocument();
    });
  });

  it("administración aplica SoD en selector de roles y muestra API Keys solo a Master", async () => {
    const hAdmin = createMockFetchHarness("administrador");
    const apiAdmin = new StockAgentApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getToken: () => "session-tok-abc",
      fetchImpl: hAdmin.fetchImpl,
    });

    window.localStorage.setItem(
      "stockagent_session_v1",
      JSON.stringify({
        token: "session-tok-abc",
        user: {
          id: 3,
          username: "ana_admin",
          role: "administrador",
          nombre: "Ana Admin",
          email: "",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          must_change_password: false,
        },
      })
    );

    const { unmount } = render(
      <App apiClient={apiAdmin} realtimeClient={createMockRealtime()} />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Administración$/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/SoD: Solo el rol Master puede crear Administradores/i)
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /^API Keys$/i })).toBeNull();
    unmount();

    // Master sí ve pestaña API Keys
    window.localStorage.setItem(
      "stockagent_session_v1",
      JSON.stringify({
        token: "session-tok-master",
        user: {
          id: 1,
          username: "Auditoria",
          role: "master",
          nombre: "Master",
          email: "",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          must_change_password: false,
        },
      })
    );

    const hMaster = createMockFetchHarness("master");
    const apiMaster = new StockAgentApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getToken: () => "session-tok-master",
      fetchImpl: hMaster.fetchImpl,
    });

    render(<App apiClient={apiMaster} realtimeClient={createMockRealtime()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Administración$/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^API Keys$/i })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /SaaS y Backups/i }));
    await waitFor(() => {
      expect(screen.getByText(/Plan SaaS: Principal/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Exportar Backup/i })
      ).toBeInTheDocument();
    });
  });

  it("incluye manifest PWA válido, ícono SVG y Service Worker sin cacheo de /api/", () => {
    const manifestPath = resolve(WEB_PUBLIC_DIR, "manifest.webmanifest");
    const swPath = resolve(WEB_PUBLIC_DIR, "sw.js");
    const iconPath = resolve(WEB_PUBLIC_DIR, "icon.svg");

    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(swPath)).toBe(true);
    expect(existsSync(iconPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      display: string;
      shortcuts?: unknown[];
      icons?: Array<{ src: string }>;
    };
    expect(manifest.display).toBe("standalone");
    expect(manifest.shortcuts?.length).toBeGreaterThanOrEqual(2);
    expect(manifest.icons?.[0]?.src).toBe("/icon.svg");

    const swSource = readFileSync(swPath, "utf8");
    expect(swSource).toContain('url.pathname.startsWith("/api/")');
    expect(swSource).toContain("stockagent-shell-v2");
  });
});

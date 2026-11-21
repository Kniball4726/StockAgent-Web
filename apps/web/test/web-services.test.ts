import { describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  StockAgentApiClient,
} from "../src/lib/api-client";
import { extraerCodigoDespacho } from "../src/lib/barcode-scanner";
import {
  OfflineDispatchQueue,
  type StorageLike,
} from "../src/lib/offline-dispatch-queue";
import {
  buildWebSocketUrl,
  StockAgentRealtimeClient,
} from "../src/lib/realtime-ws";

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => {
      store.set(key, val);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

describe("Fase 5 - Servicios Web (Scanner, Cola Offline, API Client, WebSocket)", () => {
  it("extraerCodigoDespacho extrae texto plano, JSON QR y URL con query params", () => {
    expect(extraerCodigoDespacho("  REMITO:NP-001|BULTO:1/2 \r\n")).toBe(
      "REMITO:NP-001|BULTO:1/2"
    );
    expect(extraerCodigoDespacho('{"nota_pedido":"NP-777","bultos":2}')).toBe(
      "NP-777"
    );
    expect(
      extraerCodigoDespacho("https://app.stockagent.test/despacho?codigo=GUIA-99")
    ).toBe("GUIA-99");
  });

  it("OfflineDispatchQueue aísla por tenant, deduplica y conserva items ante falla de red", async () => {
    const storage = createMemoryStorage();
    const queueTenantA = new OfflineDispatchQueue("tenant-a", storage);
    const queueTenantB = new OfflineDispatchQueue("tenant-b", storage);

    const first = queueTenantA.enqueue("NP-001", "despachado");
    expect(first.deduplicated).toBe(false);
    const dup = queueTenantA.enqueue("np-001", "despachado");
    expect(dup.deduplicated).toBe(true);
    queueTenantA.enqueue("NP-002", "entregado");

    expect(queueTenantA.list()).toHaveLength(2);
    expect(queueTenantB.list()).toHaveLength(0);

    // Falla de red conserva los items y suma attempts
    const failedSummary = await queueTenantA.flush(async () => {
      throw new Error("Sin conexión");
    });
    expect(failedSummary.networkFailed).toBe(true);
    expect(failedSummary.remainingCount).toBe(2);
    expect(queueTenantA.list()[0]?.attempts).toBe(1);

    // Al reconectar sincroniza lote e informa eventual rechazo de negocio sin loop infinito
    const okSummary = await queueTenantA.flush(async (items) => {
      expect(items).toHaveLength(2);
      return {
        ok: true,
        total_procesados: 2,
        exitosos: 1,
        fallidos: 1,
        resultados: [
          { ok: true, codigo: "NP-001", estado_despacho: "despachado" },
          { ok: false, codigo: "NP-002", message: "Pedido inexistente" },
        ],
      };
    });

    expect(okSummary.networkFailed).toBe(false);
    expect(okSummary.syncedCount).toBe(1);
    expect(okSummary.rejected).toHaveLength(1);
    expect(okSummary.rejected[0]?.reason).toContain("inexistente");
    expect(queueTenantA.list()).toHaveLength(0);
  });

  it("StockAgentApiClient distingue fallos de red y dispara onUnauthorized en 401 protegido", async () => {
    const onUnauthorized = vi.fn();
    const mockFetch: typeof fetch = async (input) => {
      const url = input.toString();
      if (url.endsWith("/api/v1/auth/login")) {
        return new Response(
          JSON.stringify({ ok: false, detail: "Credenciales inválidas" }),
          { status: 401 }
        );
      }
      if (url.endsWith("/api/v1/productos/buscar?limit=100")) {
        return new Response(
          JSON.stringify({ ok: false, detail: "Token expirado" }),
          { status: 401 }
        );
      }
      throw new TypeError("Failed to fetch");
    };

    const api = new StockAgentApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getToken: () => "tok-123",
      onUnauthorized,
      fetchImpl: mockFetch,
    });

    // En login 401 NO dispara auto-logout global
    await expect(
      api.login({ username: "u", password: "wrong" })
    ).rejects.toMatchObject({ status: 401, isNetworkError: false });
    expect(onUnauthorized).not.toHaveBeenCalled();

    // En ruta protegida 401 SÍ dispara onUnauthorized
    await expect(api.searchProducts("", 100)).rejects.toBeInstanceOf(
      ApiClientError
    );
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    // En fallo de red marca isNetworkError: true
    await expect(api.ping()).rejects.toMatchObject({
      isNetworkError: true,
      code: "NETWORK_ERROR",
    });
  });

  it("StockAgentRealtimeClient construye URL ws(s), emite eventos y detiene reconexión con código 1008", () => {
    expect(buildWebSocketUrl("https://api.stockagent.app", "a b")).toBe(
      "wss://api.stockagent.app/api/v1/ws?token=a%20b"
    );

    const sockets: Array<{
      url: string;
      readyState: number;
      onopen: (() => void) | null;
      onmessage: ((e: { data: string }) => void) | null;
      onclose: ((e: { code: number }) => void) | null;
      onerror: (() => void) | null;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];

    class FakeWebSocket {
      static readonly OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: ((e: { code: number }) => void) | null = null;
      onerror: (() => void) | null = null;
      send = vi.fn();
      close = vi.fn();

      constructor(public url: string) {
        sockets.push(this);
      }
    }

    vi.stubGlobal("WebSocket", FakeWebSocket);
    try {
      const client = new StockAgentRealtimeClient();
      const states: string[] = [];
      const events: string[] = [];

      client.onStatusChange((s) => states.push(s));
      client.onEvent((ev) => {
        if (ev.type) events.push(ev.type);
      });

      client.connect("http://127.0.0.1:3000", "tok-ws");
      expect(sockets).toHaveLength(1);
      sockets[0]?.onopen?.();
      sockets[0]?.onmessage?.({
        data: JSON.stringify({
          event: "domain_event",
          type: "STOCK_UPDATED",
          payload: { code: "101" },
        }),
      });

      expect(states).toContain("connected");
      expect(events).toEqual(["STOCK_UPDATED"]);

      // Código 1008 (sesión rechazada) no debe pasar a reconnecting
      sockets[0]?.onclose?.({ code: 1008 });
      expect(states[states.length - 1]).toBe("disconnected");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

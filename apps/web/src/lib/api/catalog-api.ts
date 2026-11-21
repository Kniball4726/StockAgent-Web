import type {
  BuscarProductosResponse,
  ProductoItemResponse,
  UpsertProductRequest,
} from "@stockagent/shared";
import type { BaseHttpClient } from "./http-client";
import type {
  InventarioResultadoResponse,
  ReplenishmentItemDto,
  StockMovementRow,
} from "./types";

export class CatalogInventoryApi {
  constructor(private readonly http: BaseHttpClient) {}

  searchProducts(q = "", limit = 100): Promise<BuscarProductosResponse> {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    params.set("limit", String(limit));
    return this.http.request(`/api/v1/productos/buscar?${params.toString()}`, {
      method: "GET",
    });
  }

  getProduct(codeOrBarcode: string): Promise<ProductoItemResponse> {
    return this.http.request(
      `/api/v1/productos/${encodeURIComponent(codeOrBarcode)}`,
      { method: "GET" }
    );
  }

  upsertProduct(
    payload: UpsertProductRequest
  ): Promise<{ ok: boolean; producto: ProductoItemResponse }> {
    return this.http.request("/api/v1/productos", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  adjustProductStock(
    code: string,
    payload: {
      delta: number;
      movement_type:
        | "descuento"
        | "ingreso_fabrica"
        | "ingreso_rapido"
        | "salida_rapida"
        | "ajuste_manual";
      detalle?: string;
    }
  ): Promise<{
    ok: boolean;
    code: string;
    stock_anterior: number;
    stock_nuevo: number;
  }> {
    return this.http.request(
      `/api/v1/productos/${encodeURIComponent(code)}/ajustar`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  }

  updateProductLocation(
    code: string,
    ubicacion: string
  ): Promise<{ ok: boolean; code: string; ubicacion: string }> {
    return this.http.request(
      `/api/v1/productos/${encodeURIComponent(code)}/ubicacion`,
      {
        method: "PUT",
        body: JSON.stringify({ ubicacion }),
      }
    );
  }

  associateProductBarcode(
    code: string,
    cod_barras: string
  ): Promise<{ ok: boolean; code: string; cod_barras: string }> {
    return this.http.request(
      `/api/v1/productos/${encodeURIComponent(code)}/codigo-barras`,
      {
        method: "PUT",
        body: JSON.stringify({ cod_barras }),
      }
    );
  }

  getReplenishmentAnalysis(
    soloCriticos = false
  ): Promise<{ ok: boolean; total: number; items: ReplenishmentItemDto[] }> {
    return this.http.request(
      `/api/v1/productos/reposicion/analisis?solo_criticos=${soloCriticos}`,
      { method: "GET" }
    );
  }

  getMovementsHistory(
    limit = 100
  ): Promise<{ ok: boolean; total: number; movimientos: StockMovementRow[] }> {
    return this.http.request(
      `/api/v1/productos/movimientos/historial?limit=${limit}`,
      { method: "GET" }
    );
  }

  comparePreliminaryInventory(
    conteo: Record<string, number>,
    nombreArchivo?: string
  ): Promise<InventarioResultadoResponse> {
    return this.http.request("/api/v1/inventario/comparar-preliminar", {
      method: "POST",
      body: JSON.stringify({
        conteo,
        ...(nombreArchivo ? { nombre_archivo: nombreArchivo } : {}),
      }),
    });
  }

  finalizePhysicalInventory(
    conteo: Record<string, number>,
    nombreArchivo?: string
  ): Promise<InventarioResultadoResponse> {
    return this.http.request("/api/v1/inventario/finalizar", {
      method: "POST",
      body: JSON.stringify({
        conteo,
        ...(nombreArchivo ? { nombre_archivo: nombreArchivo } : {}),
      }),
    });
  }
}

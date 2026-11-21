import type { PedidoDetalleResponse } from "@stockagent/shared";
import type {
  DispatchBatchResponse,
  DispatchStatusTarget,
} from "../offline-dispatch-queue";
import type { BaseHttpClient } from "./http-client";

export class DispatchApi {
  constructor(private readonly http: BaseHttpClient) {}

  listDispatchOrders(
    estadoDespacho = "",
    limit = 100
  ): Promise<{ total: number; pedidos: PedidoDetalleResponse[] }> {
    const params = new URLSearchParams();
    if (estadoDespacho) params.set("estado_despacho", estadoDespacho);
    params.set("limit", String(limit));
    return this.http.request(`/api/v1/despacho/pedidos?${params.toString()}`, {
      method: "GET",
    });
  }

  getDispatchOrder(notaPedido: string): Promise<PedidoDetalleResponse> {
    return this.http.request(
      `/api/v1/despacho/pedidos/${encodeURIComponent(notaPedido)}`,
      { method: "GET" }
    );
  }

  scanDispatch(
    codigo: string,
    nuevo_estado?: DispatchStatusTarget
  ): Promise<{ ok: boolean; mensaje: string; pedido: PedidoDetalleResponse }> {
    return this.http.request("/api/v1/despacho/escanear", {
      method: "POST",
      body: JSON.stringify({
        codigo,
        ...(nuevo_estado ? { nuevo_estado } : {}),
      }),
    });
  }

  scanDispatchBatch(
    items: Array<{ codigo: string; nuevo_estado?: DispatchStatusTarget }>
  ): Promise<DispatchBatchResponse> {
    return this.http.request("/api/v1/despacho/escanear-lote", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  }

  acquireOrderLock(
    orderId: number
  ): Promise<{ ok: boolean; acquired: boolean; lockedBy?: string }> {
    return this.http.request(`/api/v1/despacho/pedidos/${orderId}/lock`, {
      method: "POST",
    });
  }

  releaseOrderLock(orderId: number): Promise<{ ok: boolean }> {
    return this.http.request(`/api/v1/despacho/pedidos/${orderId}/lock`, {
      method: "DELETE",
    });
  }
}

import type { IngestionDocumentInput } from "@stockagent/shared";

export const DEFAULT_API_BASE = "https://api.mercadolibre.com";
export const DEFAULT_AUTH_BASE = "https://auth.mercadolibre.com.ar";

export interface MercadoLibreRawOrder {
  id: number | string;
  date_created?: string;
  buyer?: {
    first_name?: string;
    last_name?: string;
    nickname?: string;
  };
  shipping?: {
    id?: number | string;
  };
  order_items?: Array<{
    quantity?: number;
    unit_price?: number;
    item?: {
      title?: string;
      seller_sku?: string;
      seller_custom_field?: string;
    };
  }>;
}

export interface MappedMercadoLibreOrder {
  ordenId: string;
  refPedido: string;
  cliente: string;
  fecha: string;
  shippingId: string;
  archivoHash: string;
  itemsCoincidentes: Array<{
    codigo: string;
    nombre: string;
    cantidad: number;
    stockActual: number;
    precio: number;
    metodo: "SKU" | "Fuzzy Título";
    stockSuficiente: boolean;
  }>;
  itemsNoCoincidentes: Array<{
    titulo: string;
    sku: string;
    cantidad: number;
    precio: number;
    motivo: string;
  }>;
  totalUnidades: number;
  totalImporte: number;
  todosCoinciden: boolean;
  stockSuficiente: boolean;
  ingestionDocument: IngestionDocumentInput;
}

export interface MercadoLibreServiceOptions {
  apiBaseUrl?: string | undefined;
  authBaseUrl?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

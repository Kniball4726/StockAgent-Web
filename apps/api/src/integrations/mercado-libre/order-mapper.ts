import {
  resolverProductoEnCatalogo,
  type CatalogProductSnapshot,
} from "@stockagent/shared";
import { buscarCodigoPorDescripcionMl } from "../../parsers/mercado-libre-parser.js";
import { hashSha256 } from "../../security/crypto.js";
import type {
  MappedMercadoLibreOrder,
  MercadoLibreRawOrder,
} from "./types.js";

export function mapMercadoLibreOrderToDocument(
  orden: MercadoLibreRawOrder,
  catalog: readonly CatalogProductSnapshot[]
): MappedMercadoLibreOrder {
  const ordenId = String(orden.id ?? "").trim();
  const refPedido = `ML-${ordenId}`;
  const buyer = orden.buyer ?? {};
  const fullName = `${buyer.first_name ?? ""} ${buyer.last_name ?? ""}`.trim();
  const cliente =
    fullName || String(buyer.nickname ?? "Comprador Mercado Libre").trim();
  const fecha = String(orden.date_created ?? "")
    .slice(0, 19)
    .replace("T", " ");
  const shippingId = String(orden.shipping?.id ?? "").trim();
  const archivoHash = hashSha256(`ML_API_ORDER_${ordenId}`);

  const descripcionesCatalogo = new Map<string, string[]>();
  const catalogByCode = new Map<string, CatalogProductSnapshot>();
  for (const prod of catalog) {
    catalogByCode.set(prod.code.toLowerCase(), prod);
    if (prod.name) {
      const list = descripcionesCatalogo.get(prod.code) ?? [];
      if (!list.includes(prod.name)) {
        list.push(prod.name);
      }
      descripcionesCatalogo.set(prod.code, list);
    }
  }

  const itemsCoincidentes: MappedMercadoLibreOrder["itemsCoincidentes"] = [];
  const itemsNoCoincidentes: MappedMercadoLibreOrder["itemsNoCoincidentes"] =
    [];

  for (const elem of orden.order_items ?? []) {
    const itObj = elem.item ?? {};
    const skuRaw = String(
      itObj.seller_sku ?? itObj.seller_custom_field ?? ""
    ).trim();
    const titulo = String(itObj.title ?? "").trim();
    const cantidad = Math.max(1, Math.trunc(Number(elem.quantity ?? 1)));
    const precio = Number(elem.unit_price ?? 0);

    let matchedProd: CatalogProductSnapshot | null = null;
    let metodo: "SKU" | "Fuzzy Título" = "SKU";
    let motivo = "";

    if (skuRaw) {
      matchedProd = resolverProductoEnCatalogo(catalog, skuRaw);
    }

    if (!matchedProd && titulo) {
      const fuzzy = buscarCodigoPorDescripcionMl(titulo, descripcionesCatalogo);
      if (fuzzy.codigo) {
        matchedProd = catalogByCode.get(fuzzy.codigo.toLowerCase()) ?? null;
        metodo = "Fuzzy Título";
      } else {
        motivo = fuzzy.motivo;
      }
    }

    if (matchedProd) {
      itemsCoincidentes.push({
        codigo: matchedProd.code,
        nombre: matchedProd.name,
        cantidad,
        stockActual: matchedProd.stock,
        precio,
        metodo,
        stockSuficiente: matchedProd.stock >= cantidad,
      });
    } else {
      itemsNoCoincidentes.push({
        titulo,
        sku: skuRaw,
        cantidad,
        precio,
        motivo: motivo || "Sin coincidencia en catálogo",
      });
    }
  }

  const totalUnidades = itemsCoincidentes.reduce(
    (acc, it) => acc + it.cantidad,
    0
  );
  const totalImporte = itemsCoincidentes.reduce(
    (acc, it) => acc + it.cantidad * it.precio,
    0
  );

  const ingestionItems = [
    ...itemsCoincidentes.map((it) => ({
      codigo: it.codigo,
      descripcion: it.nombre,
      cantidad: it.cantidad,
      origenRemito: refPedido,
    })),
    ...itemsNoCoincidentes.map((it) => ({
      codigo: `UNMATCHED:${(it.sku || it.titulo).slice(0, 48)}`,
      descripcion: it.titulo || it.sku || "Ítem Mercado Libre",
      cantidad: it.cantidad,
      origenRemito: refPedido,
    })),
  ];

  return {
    ordenId,
    refPedido,
    cliente,
    fecha,
    shippingId,
    archivoHash,
    itemsCoincidentes,
    itemsNoCoincidentes,
    totalUnidades,
    totalImporte,
    todosCoinciden:
      itemsNoCoincidentes.length === 0 && itemsCoincidentes.length > 0,
    stockSuficiente: itemsCoincidentes.every((it) => it.stockSuficiente),
    ingestionDocument: {
      notaPedido: refPedido,
      numeroPedido: refPedido,
      cliente,
      bultos: 1,
      logistica: "Transporte",
      armador: "",
      tipoArchivo: "docx",
      nombreArchivo: `ML_API_${ordenId}.docx`,
      fechaRetiro: "",
      archivoHash,
      numeroGuia: shippingId,
      canal: "mercado_libre",
      items: ingestionItems,
    },
  };
}

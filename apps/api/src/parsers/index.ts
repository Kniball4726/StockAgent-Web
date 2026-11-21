import { extname } from "node:path";
import type {
  FileUploadCategory,
  IngestionDocumentInput,
  IngestionOperation,
} from "@stockagent/shared";
import { DomainError } from "../repositories/base.js";
import { parsearCanjeSpreadsheet } from "./canjes-parser.js";
import { parsearArchivoFabrica } from "./factory-parser.js";
import { parsearArchivoMercadoFull } from "./mercado-full-parser.js";
import { parsearPedidoMercadoLibreDocx } from "./mercado-libre-parser.js";
import { parsearRemitoPdf } from "./remito-parser.js";
import { parsearStockFisicoSpreadsheet } from "./physical-stock-parser.js";
import type { ParsedDocumentEnvelope, ParsedRemitoResult } from "./types.js";

export * from "./canjes-parser.js";
export * from "./factory-parser.js";
export * from "./mercado-full-parser.js";
export * from "./mercado-libre-parser.js";
export * from "./physical-stock-parser.js";
export * from "./remito-parser.js";
export * from "./spreadsheet-reader.js";
export * from "./types.js";

function remitoToIngestionDocument(
  res: ParsedRemitoResult,
  options: {
    sourceFileId?: string | undefined;
    sha256: string;
    logistica: IngestionDocumentInput["logistica"];
    tipoArchivo: IngestionDocumentInput["tipoArchivo"];
    canal: IngestionDocumentInput["canal"];
  }
): IngestionDocumentInput {
  const items = [
    ...res.items.map((it) => ({
      codigo: it.codigo,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      origenRemito: it.origenRemito,
    })),
    ...res.descripcionesSinCoincidencia.map(([desc, _motivo]) => {
      const m = desc.match(/^(\d+)\s+(.+)$/);
      const qty = m?.[1] ? Math.max(1, Number(m[1])) : 1;
      const label = (m?.[2] ?? desc).trim() || "Sin coincidencia";
      return {
        codigo: `UNMATCHED:${label.slice(0, 48)}`,
        descripcion: desc,
        cantidad: qty,
        origenRemito: res.numeroRemito,
      };
    }),
  ];

  return {
    sourceFileId: options.sourceFileId,
    notaPedido: res.numeroRemito,
    numeroPedido: res.numeroRemito,
    cliente: res.cliente,
    bultos: 1,
    logistica: options.logistica,
    armador: "",
    tipoArchivo: options.tipoArchivo,
    nombreArchivo: res.archivo,
    fechaRetiro: res.fechaDespacho || "",
    archivoHash: options.sha256,
    numeroGuia: "",
    canal: options.canal,
    articulosDeclarados: res.articulosDeclarados ?? undefined,
    items,
  };
}

export async function parseUploadedDocumentBuffer(params: {
  category: FileUploadCategory;
  buffer: Buffer;
  filename: string;
  sha256: string;
  sourceFileId?: string | undefined;
  operationOverride?: IngestionOperation | undefined;
  catalog: ReadonlyArray<{ codigo: string; nombre: string }>;
}): Promise<ParsedDocumentEnvelope> {
  const ext = extname(params.filename).toLowerCase();
  let effectiveCategory = params.category;

  if (effectiveCategory === "adjunto" || effectiveCategory === "reporte") {
    if (ext === ".pdf") effectiveCategory = "remito_mayorista";
    else if (ext === ".docx") effectiveCategory = "mercado_libre";
    else if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
      effectiveCategory = "canje";
    }
  }

  if (effectiveCategory === "remito_mayorista") {
    if (ext !== ".pdf") {
      throw new DomainError(
        "INVALID_FORMAT_FOR_CATEGORY",
        "Los remitos mayoristas deben estar en formato PDF (.pdf).",
        400
      );
    }
    const parsed = await parsearRemitoPdf(params.buffer, params.filename);
    const suggestedOperation = params.operationOverride ?? "descuento_pedidos";
    return {
      suggestedOperation,
      parsedMeta: parsed,
      document: remitoToIngestionDocument(parsed, {
        sourceFileId: params.sourceFileId,
        sha256: params.sha256,
        logistica: "Domicilio",
        tipoArchivo: "pdf",
        canal: "mayorista",
      }),
    };
  }

  if (effectiveCategory === "canje") {
    const parsed = await parsearCanjeSpreadsheet(params.buffer, params.filename);
    const suggestedOperation = params.operationOverride ?? "descuento_pedidos";
    return {
      suggestedOperation,
      parsedMeta: parsed,
      document: remitoToIngestionDocument(parsed, {
        sourceFileId: params.sourceFileId,
        sha256: params.sha256,
        logistica: "Canje",
        tipoArchivo: "excel",
        canal: "canje",
      }),
    };
  }

  if (effectiveCategory === "mercado_libre") {
    if (ext !== ".docx") {
      throw new DomainError(
        "INVALID_FORMAT_FOR_CATEGORY",
        "Las comandas de Mercado Libre deben estar en formato Word (.docx).",
        400
      );
    }
    const parsed = await parsearPedidoMercadoLibreDocx(
      params.buffer,
      params.filename,
      params.catalog
    );
    const suggestedOperation = params.operationOverride ?? "descuento_pedidos";
    return {
      suggestedOperation,
      parsedMeta: parsed,
      document: remitoToIngestionDocument(parsed, {
        sourceFileId: params.sourceFileId,
        sha256: params.sha256,
        logistica: "Transporte",
        tipoArchivo: "docx",
        canal: "mercado_libre",
      }),
    };
  }

  if (effectiveCategory === "mercado_full") {
    const parsed = await parsearArchivoMercadoFull(
      params.buffer,
      params.filename
    );
    const suggestedOperation = params.operationOverride ?? "plan_full";
    return {
      suggestedOperation,
      parsedMeta: parsed,
      document: {
        sourceFileId: params.sourceFileId,
        notaPedido: parsed.numeroDocumento,
        numeroPedido: parsed.numeroDocumento,
        cliente: "Mercado Envíos Full",
        bultos: 1,
        logistica: "Domicilio",
        armador: "",
        tipoArchivo: "excel",
        nombreArchivo: parsed.archivo,
        fechaRetiro: "",
        archivoHash: params.sha256,
        numeroGuia: "",
        canal: "full",
        items: parsed.detalle.map((it) => ({
          codigo: it.codigo,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          origenRemito: parsed.numeroDocumento,
        })),
      },
    };
  }

  if (effectiveCategory === "ingreso_fabrica") {
    const parsed = await parsearArchivoFabrica(params.buffer, params.filename);
    const suggestedOperation = params.operationOverride ?? "ingreso_fabrica";
    return {
      suggestedOperation,
      parsedMeta: parsed,
      document: {
        sourceFileId: params.sourceFileId,
        notaPedido: parsed.numeroDocumento,
        numeroPedido: parsed.numeroDocumento,
        cliente: "Ingreso de Fábrica",
        bultos: 1,
        logistica: "Transporte",
        armador: "",
        tipoArchivo: ext === ".pdf" ? "pdf" : "excel",
        nombreArchivo: parsed.archivo,
        fechaRetiro: "",
        archivoHash: params.sha256,
        numeroGuia: "",
        canal: "otro",
        items: parsed.detalle.map((it) => ({
          codigo: it.codigo,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          origenRemito: parsed.numeroDocumento,
        })),
      },
    };
  }

  if (effectiveCategory === "stock_fisico") {
    const parsed = await parsearStockFisicoSpreadsheet(
      params.buffer,
      params.filename
    );
    const suggestedOperation = params.operationOverride ?? "stock_fisico";
    return {
      suggestedOperation,
      parsedMeta: parsed,
      document: {
        sourceFileId: params.sourceFileId,
        notaPedido: parsed.numeroDocumento,
        numeroPedido: parsed.numeroDocumento,
        cliente: "Relevamiento Stock Físico",
        bultos: 1,
        logistica: "Domicilio",
        armador: "",
        tipoArchivo: "excel",
        nombreArchivo: parsed.archivo,
        fechaRetiro: "",
        archivoHash: params.sha256,
        numeroGuia: "",
        canal: "otro",
        items: parsed.detalle.map((it) => ({
          codigo: it.codigo,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          origenRemito: parsed.numeroDocumento,
        })),
      },
    };
  }

  throw new DomainError(
    "CATEGORY_NOT_PARSEABLE",
    `La categoría '${params.category}' no dispone de parser automático.`,
    400
  );
}

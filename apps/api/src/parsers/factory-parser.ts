import { extname } from "node:path";
import { normalizarCodigo } from "@stockagent/shared";
import { DomainError } from "../repositories/base.js";
import { parsearRemitoPdf } from "./remito-parser.js";
import {
  extractRowsFromSpreadsheetGrid,
  readSpreadsheetGrid,
  stripFileExtension,
} from "./spreadsheet-reader.js";
import type {
  ParsedSpreadsheetDetail,
  ParsedSpreadsheetSummary,
} from "./types.js";

/**
 * Parsea planillas Excel/CSV (.xlsx, .xls, .csv) de ingreso de fábrica.
 */
export async function parsearPedidoFabricaSpreadsheet(
  buffer: Buffer,
  fileName: string
): Promise<ParsedSpreadsheetSummary> {
  const grid = await readSpreadsheetGrid(buffer, fileName);
  const { consolidado, detalle, totalUnidades } =
    extractRowsFromSpreadsheetGrid(grid, {
      maxHeaderRows: 15,
      codeKeywords: ["CODIGO", "COD", "ARTICULO", "CÓDIGO", "ARTÍCULO", "SKU"],
      descKeywords: ["DESCRIPCION", "DESCRIPCIÓN", "PRODUCTO", "DETALLE", "NOMBRE"],
      qtyKeywords: ["CANTIDAD", "CANT", "UNIDADES", "INGRESO", "STOCK", "PEDIDO"],
      minQty: 1,
    });

  return {
    archivo: fileName,
    numeroDocumento: `FAB-${stripFileExtension(fileName)}`,
    consolidado,
    detalle,
    totalUnidades,
  };
}

/**
 * Parsea remitos PDF de fábrica reutilizando `parsearRemitoPdf`.
 */
export async function parsearPedidoFabricaPdf(
  buffer: Buffer,
  fileName: string
): Promise<ParsedSpreadsheetSummary> {
  const resultado = await parsearRemitoPdf(buffer, fileName);
  const detalle: ParsedSpreadsheetDetail[] = [];
  const consolidado: Record<string, number> = {};
  let totalUnidades = 0;

  for (const it of resultado.items) {
    const cod = normalizarCodigo(it.codigo);
    if (!cod || it.cantidad <= 0) {
      continue;
    }
    detalle.push({
      codigo: cod,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
    });
    consolidado[cod] = (consolidado[cod] ?? 0) + it.cantidad;
    totalUnidades += it.cantidad;
  }

  return {
    archivo: fileName,
    numeroDocumento:
      resultado.numeroRemito || `FAB-${stripFileExtension(fileName)}`,
    consolidado,
    detalle,
    totalUnidades,
  };
}

/**
 * Detecta la extensión (.xlsx, .xls, .csv, .pdf) y parsea el remito o planilla de fábrica.
 */
export async function parsearArchivoFabrica(
  buffer: Buffer,
  fileName: string
): Promise<ParsedSpreadsheetSummary> {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
    return parsearPedidoFabricaSpreadsheet(buffer, fileName);
  }
  if (ext === ".pdf") {
    return parsearPedidoFabricaPdf(buffer, fileName);
  }
  throw new DomainError(
    "UNSUPPORTED_FACTORY_FORMAT",
    `Formato no soportado para pedidos de fábrica: '${ext}'. Use .xlsx, .xls, .csv o .pdf.`,
    400
  );
}

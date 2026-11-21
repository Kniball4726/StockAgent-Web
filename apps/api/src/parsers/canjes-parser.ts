import { normalizarCodigo } from "@stockagent/shared";
import {
  parsePositiveOrZeroInt,
  readSpreadsheetGrid,
  stripFileExtension,
} from "./spreadsheet-reader.js";
import type { ParsedRemitoItem, ParsedRemitoResult } from "./types.js";

/**
 * Parsea planillas de Canjes (.xlsx, .xls o .csv) manteniendo paridad con `canjes_parser.py`.
 */
export async function parsearCanjeSpreadsheet(
  buffer: Buffer,
  fileName: string
): Promise<ParsedRemitoResult> {
  const grid = await readSpreadsheetGrid(buffer, fileName);
  const getCell = (r0: number, c0: number): string =>
    (grid[r0]?.[c0] ?? "").trim();

  const observacion = getCell(0, 0);
  const clienteRaw = getCell(1, 0);
  const dniRaw = getCell(2, 0);

  let cliente = clienteRaw || "Canje Particular";
  if (dniRaw) {
    cliente = `${cliente} (${dniRaw})`;
  }

  const stemPart = stripFileExtension(fileName).split(".")[0] ?? "CANJE";
  const numeroCanje = `CANJE-${stemPart}`;

  let headerRowIdx = 4; // Fila 5 (base 0 = 4) por defecto
  let colPedido = 0;
  let colCodigo = 1;
  let colDesc = 2;

  for (let r = 0; r < Math.min(15, grid.length); r += 1) {
    const upperVals = (grid[r] ?? []).slice(0, 10).map((v) => v.trim().toUpperCase());
    const idxPedido = upperVals.indexOf("PEDIDO");
    const idxCodigo = upperVals.findIndex(
      (v) => v === "CODIGO" || v === "CÓDIGO"
    );
    if (idxPedido !== -1 && idxCodigo !== -1) {
      headerRowIdx = r;
      colPedido = idxPedido;
      colCodigo = idxCodigo;
      colDesc = colCodigo + 1;
      break;
    }
  }

  const items: ParsedRemitoItem[] = [];
  for (let r = headerRowIdx + 1; r < grid.length; r += 1) {
    const rawPedido = getCell(r, colPedido);
    const rawCodigo = getCell(r, colCodigo);
    const desc = getCell(r, colDesc);

    if (!rawPedido || !rawCodigo) {
      continue;
    }

    const numVal = parsePositiveOrZeroInt(rawPedido);
    if (numVal !== null && numVal > 0) {
      const cod = normalizarCodigo(rawCodigo);
      if (cod) {
        items.push({
          codigo: cod,
          descripcion: desc,
          cantidad: numVal,
          origenRemito: numeroCanje,
        });
      }
    }
  }

  const totalArticulos = items.reduce((acc, it) => acc + it.cantidad, 0);

  return {
    archivo: fileName,
    numeroRemito: numeroCanje,
    fecha: observacion || "Canje",
    cliente,
    articulosDeclarados: totalArticulos,
    articulosExtraidos: totalArticulos,
    verificacionOk: true,
    items,
    descripcionesSinCoincidencia: [],
    discrepancia: false,
    codigoCliente: "",
    direccion: "",
    fechaDespacho: "",
  };
}

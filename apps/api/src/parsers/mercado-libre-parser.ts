import JSZip from "jszip";
import { DomainError } from "../repositories/base.js";
import { extractNumberedItemsFromDocXml } from "./mercado-libre/docx-xml-extractor.js";
import {
  buscarCodigoPorDescripcionMl,
  normalizarDescripcionMl,
  normalizarParaBusquedaMl,
  sequenceMatcherRatio,
} from "./mercado-libre/text-matching.js";
import { stripFileExtension } from "./spreadsheet-reader.js";
import type { ParsedRemitoItem, ParsedRemitoResult } from "./types.js";

export {
  buscarCodigoPorDescripcionMl,
  normalizarDescripcionMl,
  normalizarParaBusquedaMl,
  sequenceMatcherRatio,
};

/**
 * Parsea un documento `.docx` de Mercado Libre desde Buffer en memoria.
 */
export async function parsearPedidoMercadoLibreDocx(
  buffer: Buffer,
  fileName: string,
  productosCatalogo: ReadonlyArray<{ codigo: string; nombre: string }>
): Promise<ParsedRemitoResult> {
  let xmlText = "";
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docEntry = zip.file("word/document.xml");
    if (!docEntry) {
      throw new Error("Falta word/document.xml en el paquete DOCX.");
    }
    xmlText = await docEntry.async("string");
  } catch (error) {
    throw new DomainError(
      "INVALID_DOCX",
      `No se pudo leer el archivo DOCX '${fileName}': ${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }

  const descripcionesCatalogo = new Map<string, string[]>();
  for (const prod of productosCatalogo) {
    if (!prod.nombre) {
      continue;
    }
    const existing = descripcionesCatalogo.get(prod.codigo);
    if (!existing) {
      descripcionesCatalogo.set(prod.codigo, [prod.nombre]);
    } else if (!existing.includes(prod.nombre)) {
      existing.push(prod.nombre);
    }
  }

  const registros = extractNumberedItemsFromDocXml(xmlText);
  const stem = stripFileExtension(fileName);
  const numeroRemito = `ML-${stem}`;
  const items: ParsedRemitoItem[] = [];
  const sinCoincidencia = new Map<
    string,
    { cantidad: number; descripcion: string; motivo: string }
  >();

  for (const [cantidad, descripcion] of registros) {
    const { codigo, motivo } = buscarCodigoPorDescripcionMl(
      descripcion,
      descripcionesCatalogo
    );
    if (!codigo) {
      const clave = normalizarDescripcionMl(descripcion);
      const prev = sinCoincidencia.get(clave);
      if (prev) {
        prev.cantidad += cantidad;
      } else {
        sinCoincidencia.set(clave, {
          cantidad,
          descripcion,
          motivo,
        });
      }
      continue;
    }
    items.push({
      codigo,
      descripcion,
      cantidad,
      origenRemito: numeroRemito,
    });
  }

  const totalDeclarados = registros.reduce((acc, [c]) => acc + c, 0);
  const totalExtraidos = items.reduce((acc, it) => acc + it.cantidad, 0);

  return {
    archivo: fileName,
    numeroRemito,
    fecha: "Mercado Libre",
    cliente: "Mercado Libre",
    articulosDeclarados: totalDeclarados,
    articulosExtraidos: totalExtraidos,
    verificacionOk: sinCoincidencia.size === 0,
    items,
    descripcionesSinCoincidencia: Array.from(sinCoincidencia.values()).map(
      (v) => [`${v.cantidad} ${v.descripcion}`, v.motivo]
    ),
    discrepancia: sinCoincidencia.size > 0,
    codigoCliente: "",
    direccion: "",
    fechaDespacho: "",
  };
}

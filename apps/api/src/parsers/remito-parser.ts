import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normalizarCodigo } from "@stockagent/shared";
import { stripFileExtension } from "./spreadsheet-reader.js";
import type { ParsedRemitoItem, ParsedRemitoResult } from "./types.js";

interface PdfTextChunk {
  str: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Extrae el texto de todas las páginas de un Buffer PDF reconstruyendo las líneas por coordenada Y/X.
 */
export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    useWorkerFetch: false,
    disableFontFace: true,
  });

  try {
    const pdfDoc = await loadingTask.promise;
    const pagesText: string[] = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum += 1) {
      const page = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const chunks: PdfTextChunk[] = [];

      for (const rawItem of content.items) {
        if (
          typeof rawItem === "object" &&
          rawItem !== null &&
          "str" in rawItem &&
          "transform" in rawItem &&
          Array.isArray(rawItem.transform)
        ) {
          const str = String(rawItem.str ?? "");
          if (!str) {
            continue;
          }
          const x = Number(rawItem.transform[4] ?? 0);
          const y = Number(rawItem.transform[5] ?? 0);
          const width = Number("width" in rawItem ? rawItem.width ?? 0 : 0);
          chunks.push({ str, x, y, width });
        }
      }

      const linesByY = new Map<number, PdfTextChunk[]>();
      for (const chunk of chunks) {
        let matchedY: number | undefined;
        for (const keyY of linesByY.keys()) {
          if (Math.abs(keyY - chunk.y) <= 2.5) {
            matchedY = keyY;
            break;
          }
        }
        if (matchedY === undefined) {
          matchedY = chunk.y;
          linesByY.set(matchedY, []);
        }
        linesByY.get(matchedY)!.push(chunk);
      }

      const sortedY = Array.from(linesByY.keys()).sort((a, b) => b - a);
      const pageLines: string[] = [];

      for (const y of sortedY) {
        const lineChunks = linesByY.get(y)!;
        lineChunks.sort((a, b) => a.x - b.x);
        let text = "";
        let prevEndX = -1;
        for (const chunk of lineChunks) {
          const piece = chunk.str;
          if (!piece.trim()) {
            continue;
          }
          if (!text) {
            text = piece.trim();
          } else if (prevEndX >= 0 && chunk.x - prevEndX < 1.5) {
            text += piece.trim();
          } else {
            text += ` ${piece.trim()}`;
          }
          prevEndX = chunk.x + Math.max(chunk.width, 0);
        }
        if (text.trim()) {
          pageLines.push(text.trim());
        }
      }

      pagesText.push(pageLines.join("\n"));
    }

    return pagesText.join("\n");
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Parsea texto extraído de un remito PDF mayorista manteniendo paridad con `remito_parser.py`.
 */
export function parsearRemitoPdfTexto(
  fullText: string,
  fileName: string
): ParsedRemitoResult {
  const stem = stripFileExtension(fileName);

  const numMatch = fullText.match(/(\d{4}-\d{8})/);
  const numeroRemito = numMatch?.[1] ?? stem;

  const fechaMatch = fullText.match(/(\d{2}\/\d{2}\/\d{4})/);
  const fecha = fechaMatch?.[1] ?? "Sin fecha";

  const fdMatch =
    fullText.match(/fecha\s*despacho[:\s]*(\d{2}\/\d{2}\/\d{4})/i) ??
    fullText.match(/(\d{2}\/\d{2}\/\d{4})\s*fecha\s*despacho/i);
  const fechaDespacho = fdMatch?.[1] ?? "";

  let codigoCliente = "";
  let cliente = "Cliente no identificado";
  const cMatch = fullText.match(/(\d{4,6})\s+-\s+([A-Z0-9\s\-/]+)/);
  if (cMatch?.[1] && cMatch[2]) {
    codigoCliente = cMatch[1].trim();
    cliente = (cMatch[2].split("\n")[0] ?? "").trim() || cliente;
  } else {
    const cLabel = fullText.match(/Cliente:\s*([^\n\r]+)/);
    if (cLabel?.[1]) {
      const val = cLabel[1].trim();
      const mSep = val.match(/^(\d{4,6})\s+-\s+(.+)$/);
      if (mSep?.[1] && mSep[2]) {
        codigoCliente = mSep[1].trim();
        cliente = mSep[2].trim();
      } else if (val) {
        cliente = val;
      }
    }
  }

  const trimmedLines = fullText.split(/\r?\n/).map((l) => l.trim());
  let loc = "";
  let prov = "";
  for (const line of trimmedLines) {
    if (line.toLowerCase().includes("localidad:")) {
      const mLoc = line.match(/(.*?)\s*Localidad:\s*(.*)/i);
      if (mLoc) {
        prov = (mLoc[1] ?? "").trim();
        loc = (mLoc[2] ?? "").trim();
      }
      break;
    }
  }

  let calle = "";
  const idxCentro = trimmedLines.findIndex(
    (l) => l === "CENTRO DE DISTRIBUCION" || l === "SUPPLEMENTS SRL"
  );
  if (idxCentro > 0) {
    const candidata = trimmedLines[idxCentro - 1] ?? "";
    if (
      candidata !== "Marca" &&
      candidata !== "Operacion:" &&
      candidata !== "Operacion: 1-VENTAS A PREPARAR" &&
      !/^\d{4,6}\s*-/.test(candidata)
    ) {
      calle = candidata;
    }
  }

  if (!calle) {
    const mDir = fullText.match(/(?:Domicilio|Direcci[oó]n):\s*([^\n\r]+)/i);
    if (
      mDir?.[1] &&
      !["transporte", "condici"].some((k) =>
        mDir[1]!.toLowerCase().includes(k)
      )
    ) {
      calle = mDir[1].trim();
    }
  }

  let direccion = "";
  if (calle) {
    const calleLower = calle.toLowerCase();
    if (
      calleLower.includes("loc.") ||
      calleLower.includes("localidad") ||
      calleLower.includes("prov.")
    ) {
      direccion = calle;
    } else {
      const partes = [calle];
      if (loc && !calleLower.includes(loc.toLowerCase())) {
        partes.push(loc);
      }
      if (
        prov &&
        !calleLower.includes(prov.toLowerCase()) &&
        !partes.some((p) => p.toLowerCase() === "buenos aires")
      ) {
        partes.push(prov);
      }
      direccion = partes.join(", ");
    }
  }

  const cantArtMatch = fullText.match(/Cant\.\s*Articulos:\s*(\d+)/i);
  const declarados = cantArtMatch?.[1] ? Number(cantArtMatch[1]) : null;

  const rawLines = fullText.split(/\r?\n/);
  const itemsRaw: string[] = [];
  let recording = false;
  let buffer = "";

  for (const line of rawLines) {
    const clean = line.trim();
    if (!clean) {
      continue;
    }

    if (clean.includes("SUPPLEMENTS SRL") || clean.includes("Operacion:")) {
      recording = true;
      continue;
    }

    if (recording && /^P.gina\s+\d+\s+de\s+\d+$/i.test(clean)) {
      if (buffer) {
        itemsRaw.push(buffer);
        buffer = "";
      }
      recording = false;
      continue;
    }

    if (
      recording &&
      ["OBSERVACIONES", "DATOS LOGISTICA", "Forma de Pago:"].some((stop) =>
        clean.includes(stop)
      )
    ) {
      if (buffer) {
        itemsRaw.push(buffer);
        buffer = "";
      }
      recording = false;
      break;
    }

    if (recording) {
      if (/^\d+(?:\.0+)?\s+/.test(clean)) {
        if (buffer) {
          itemsRaw.push(buffer);
        }
        buffer = clean;
      } else if (buffer) {
        buffer += ` ${clean}`;
      }
    }
  }

  if (buffer) {
    itemsRaw.push(buffer);
  }

  const parsedItems: ParsedRemitoItem[] = [];
  for (const raw of itemsRaw) {
    const m = raw.match(/^(\d+(?:\.0+)?)\s+(.*?)\s+(\d+)$/);
    if (m?.[1] && m[3]) {
      const cod = normalizarCodigo(m[1]);
      const desc = (m[2] ?? "").trim();
      const qty = Number(m[3]);
      if (cod && qty > 0) {
        parsedItems.push({
          codigo: cod,
          descripcion: desc,
          cantidad: qty,
          origenRemito: numeroRemito,
        });
      }
    }
  }

  const sumaExtraida = parsedItems.reduce((acc, it) => acc + it.cantidad, 0);
  const verificacionOk = declarados === null || sumaExtraida === declarados;

  return {
    archivo: fileName,
    numeroRemito,
    fecha,
    cliente,
    articulosDeclarados: declarados,
    articulosExtraidos: sumaExtraida,
    verificacionOk,
    items: parsedItems,
    descripcionesSinCoincidencia: [],
    discrepancia: !verificacionOk,
    codigoCliente,
    direccion,
    fechaDespacho,
  };
}

export async function parsearRemitoPdf(
  buffer: Buffer,
  fileName: string
): Promise<ParsedRemitoResult> {
  const text = await extractTextFromPdfBuffer(buffer);
  return parsearRemitoPdfTexto(text, fileName);
}

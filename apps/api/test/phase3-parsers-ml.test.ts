import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizarCodigo,
  type CatalogProductSnapshot,
} from "@stockagent/shared";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/client.js";
import type { AuthContext } from "../src/http/auth-context.js";
import {
  mapMercadoLibreOrderToDocument,
  MercadoLibreService,
} from "../src/integrations/mercado-libre-service.js";
import {
  buscarCodigoPorDescripcionMl,
  parsearArchivoFabrica,
  parsearArchivoMercadoFull,
  parsearCanjeSpreadsheet,
  parsearPedidoMercadoLibreDocx,
  parsearRemitoPdf,
  parsearRemitoPdfTexto,
  parsearStockFisicoSpreadsheet,
  sequenceMatcherRatio,
} from "../src/parsers/index.js";
import type { AuditChatRepository } from "../src/repositories/audit-chat-repository.js";
import { ConflictError } from "../src/repositories/base.js";
import type { OrderRepository } from "../src/repositories/order-repository.js";
import type { ProductRepository } from "../src/repositories/product-repository.js";
import { TenantSettingsRepository } from "../src/repositories/tenant-settings-repository.js";
import { decryptSecret, hashSha256, isEncryptedSecret } from "../src/security/crypto.js";
import { FileUploadService } from "../src/services/file-service.js";
import { IngestionService } from "../src/services/ingestion-service.js";
import { LocalStorageAdapter } from "../src/storage/index.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

// Archivo .xls BIFF8 real generado con SKU/DESCRIPCION/CANTIDAD: (101 -> 7, 201.0 -> 3, TOTAL -> 10)
const SAMPLE_FULL_XLS_BASE64 =
  "0M8R4KGxGuEAAAAAAAAAAAAAAAAAAAAAPgADAP7/CQAGAAAAAAAAAAAAAAABAAAACQAAAAAAAAAAEAAA/v///wAAAAD+////AAAAAAgAAAD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8JCBAAAAYFALsNzAcAAAAABgAAAOEAAgCwBMEAAgAAAOIAAABcAHAATm9uZSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEIAAgCwBGEBAgAAAD0BAgABAJwAAgAOABkAAgAAABIAAgAAAGMAAgAAABMAAgAAAK8BAgAAALwBAgAAAEAAAgAAAI0AAgAAAD0AEgDgAVoAzz9OKjgAAAAAAAEAWAIiAAIAAAAOAAIAAQC3AQIAAADaAAIAAAAxABUAyAAAAP9/kAEAAAAAAQAFAEFyaWFsMQAVAMgAAAD/f5ABAAAAAAEABQBBcmlhbDEAFQDIAAAA/3+QAQAAAAABAAUAQXJpYWwxABUAyAAAAP9/kAEAAAAAAQAFAEFyaWFsMQAVAMgAAAD/f5ABAAAAAAEABQBBcmlhbDEAFQDIAAAA/3+QAQAAAAABAAUAQXJpYWwxABUAyAAAAP9/kAEAAAAAAQAFAEFyaWFsHgQMAKQABwAAR2VuZXJhbOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQA9f8gAAD0AAAAAAAAAADAIOAAFAAGAKQAAQAgAAD4AAAAAAAAAADAIOAAFAAHAKQAAQAgAAD4AAAAAAAAAADAIJMCBAAAgAD/YAECAAEAhQAMAPsDAAAAAAQARnVsbPwAWAAIAAAACAAAAAMAAFNLVQsAAERFU0NSSVBDSU9OCAAAQ0FOVElEQUQDAAAxMDEIAABXaGV5IDFrZwUAADIwMS4wDQAAQ3JlYXRpbmEgMzAwZwUAAFRPVEFMCgAAAAkIEAAABhAAuw3MBwAAAAAGAAAADQACAAEADAACAGQADwACAAEAEQACAAAAEAAIAPyp8dJNYlA/XwACAAAAgAAIAAAAAAABAAAAJQIEAAAA/wCBAAIAAQwAAg4AAAAAAAQAAAAAAAMAAAAqAAIAAAArAAIAAACCAAIAAQAbAAIAAAAaAAIAAAAUAAUAAgAAJlAVAAUAAgAAJkaDAAIAAQCEAAIAAAAmAAgAMzMzMzMz0z8nAAgAMzMzMzMz0z8oAAgAhetRuB6F4z8pAAgArkfhehSu1z+hACIACQBkAAEAAQABAIMALAEsAZqZmZmZmbk/mpmZmZmZuT8BABIAAgAAAN0AAgAAABkAAgAAAGMAAgAAABMAAgAAAAgCEAAAAAAAAwD/AAAAAAAAAQ8A/QAKAAAAAAARAAAAAAD9AAoAAAABABEAAQAAAP0ACgAAAAIAEQACAAAACAIQAAEAAAADAP8AAAAAAAABDwD9AAoAAQAAABEAAwAAAP0ACgABAAEAEQAEAAAAfgIKAAEAAgARAB4AAAAIAhAAAgAAAAMA/wAAAAAAAAEPAP0ACgACAAAAEQAFAAAA/QAKAAIAAQARAAYAAAB+AgoAAgACABEADgAAAAgCEAADAAAAAwD/AAAAAAAAAQ8A/QAKAAMAAAARAAcAAAB+AgoAAwACABEAKgAAAD4CEgC2AgAAAABAAAAAAAAAAAAAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAIAAAADAAAABAAAAAUAAAAGAAAABwAAAP7////9/////v////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9SAG8AbwB0ACAARQBuAHQAcgB5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFgAFAf//////////AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP7///8AAAAAAAAAAFcAbwByAGsAYgBvAG8AawAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAIB////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH///////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf///////////////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP7///8AAAAAAAAAAA==";

function escapePdfString(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function buildMinimalPdfBuffer(lines: readonly string[]): Buffer {
  const ops = lines
    .map((line, i) => `1 0 0 1 40 ${760 - i * 16} Tm (${escapePdfString(line)}) Tj`)
    .join("\n");
  const streamContent = `BT\n/F1 10 Tf\n${ops}\nET\n`;

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(streamContent, "latin1")} >>\nstream\n${streamContent}endstream\nendobj\n`,
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += obj;
  }
  const xrefOffset = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function buildXlsxBuffer(rows: ReadonlyArray<ReadonlyArray<string | number>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Hoja1");
  for (const row of rows) {
    ws.addRow([...row]);
  }
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

async function buildDocxBuffer(params: {
  paragraphs?: readonly string[];
  tables?: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>;
}): Promise<Buffer> {
  const esc = (s: string) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const pXml = (params.paragraphs ?? [])
    .map((p) => `<w:p><w:r><w:t>${esc(p)}</w:t></w:r></w:p>`)
    .join("");

  const tblXml = (params.tables ?? [])
    .map((tbl) => {
      const rowsXml = tbl
        .map((row) => {
          const cellsXml = row
            .map((cell) => `<w:tc><w:p><w:r><w:t>${esc(cell)}</w:t></w:r></w:p></w:tc>`)
            .join("");
          return `<w:tr>${cellsXml}</w:tr>`;
        })
        .join("");
      return `<w:tbl>${rowsXml}</w:tbl>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${pXml}
    ${tblXml}
  </w:body>
</w:document>`;

  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function encodeFormData(form: FormData) {
  const req = new Request("http://localhost/upload", {
    method: "POST",
    body: form,
  });
  const body = Buffer.from(await req.arrayBuffer());
  const contentType = req.headers.get("content-type") ?? "";
  return { body, contentType };
}

describe("Fase 3 - Parsers de documentos (PDF, XLSX, XLS, CSV, DOCX)", () => {
  it("parsearRemitoPdf extrae metadatos, descripciones multilínea y valida cantidad", async () => {
    const pdfBuf = buildMinimalPdfBuffer([
      "Remito Nro: 0001-00012345",
      "Fecha: 17/11/2026",
      "Fecha Despacho: 18/11/2026",
      "1024 - DISTRIBUIDORA NORTE SRL",
      "Av. Libertador 1234",
      "SUPPLEMENTS SRL",
      "Cant. Articulos: 15",
      "Operacion: 1-VENTAS A PREPARAR",
      "101 PROTEINA WHEY 1KG",
      "SABOR VAINILLA 10",
      "201.0 CREATINA MONOHIDRATO 300G 5",
      "DATOS LOGISTICA",
      "Transporte Express",
    ]);

    const parsed = await parsearRemitoPdf(pdfBuf, "remito_12345.pdf");
    expect(parsed.numeroRemito).toBe("0001-00012345");
    expect(parsed.fecha).toBe("17/11/2026");
    expect(parsed.fechaDespacho).toBe("18/11/2026");
    expect(parsed.codigoCliente).toBe("1024");
    expect(parsed.cliente).toBe("DISTRIBUIDORA NORTE SRL");
    expect(parsed.articulosDeclarados).toBe(15);
    expect(parsed.articulosExtraidos).toBe(15);
    expect(parsed.verificacionOk).toBe(true);
    expect(parsed.discrepancia).toBe(false);
    expect(parsed.items).toEqual([
      {
        codigo: "101",
        descripcion: "PROTEINA WHEY 1KG SABOR VAINILLA",
        cantidad: 10,
        origenRemito: "0001-00012345",
      },
      {
        codigo: "201",
        descripcion: "CREATINA MONOHIDRATO 300G",
        cantidad: 5,
        origenRemito: "0001-00012345",
      },
    ]);
  });

  it("parsearRemitoPdfTexto maneja múltiples páginas y detecta discrepancias", () => {
    const text = [
      "0002-00000088",
      "Cliente: 550 - GIMNASIO SUR",
      "Cant. Articulos: 20",
      "SUPPLEMENTS SRL",
      "101 PROTEINA WHEY 8",
      "Página 1 de 2",
      "Encabezado repetido",
      "Operacion: 1-VENTAS A PREPARAR",
      "201 CREATINA 4",
      "OBSERVACIONES",
    ].join("\n");

    const parsed = parsearRemitoPdfTexto(text, "remito_88.pdf");
    expect(parsed.articulosDeclarados).toBe(20);
    expect(parsed.articulosExtraidos).toBe(12);
    expect(parsed.verificacionOk).toBe(false);
    expect(parsed.discrepancia).toBe(true);
    expect(parsed.items).toHaveLength(2);
  });

  it("parsearCanjeSpreadsheet soporta .xlsx y .csv con BOM/punto y coma", async () => {
    const xlsxBuf = await buildXlsxBuffer([
      ["Retira viernes"],
      ["Juan Perez"],
      ["DNI 35111222"],
      [],
      ["PEDIDO", "CODIGO", "DESCRIPCION"],
      [4, "101.0", "Whey 1kg"],
      [0, "102", "Whey Choc"],
      [2, "201", "Creatina 300g"],
    ]);

    const resXlsx = await parsearCanjeSpreadsheet(xlsxBuf, "45.xlsx");
    expect(resXlsx.numeroRemito).toBe("CANJE-45");
    expect(resXlsx.cliente).toBe("Juan Perez (DNI 35111222)");
    expect(resXlsx.fecha).toBe("Retira viernes");
    expect(resXlsx.articulosExtraidos).toBe(6);
    expect(resXlsx.items).toHaveLength(2);

    const csvBuf = Buffer.from(
      "\uFEFFObservacion Canje;;\nMaria Gomez;;\n;;\nPEDIDO;CODIGO;DESCRIPCION\n3;101;Whey\n;201;Ignorar vacio\n",
      "utf8"
    );
    const resCsv = await parsearCanjeSpreadsheet(csvBuf, "canje_maria.csv");
    expect(resCsv.numeroRemito).toBe("CANJE-canje_maria");
    expect(resCsv.cliente).toBe("Maria Gomez");
    expect(resCsv.articulosExtraidos).toBe(3);
  });

  it("mercado-libre-parser resuelve matching fuzzy, sabores, DOCX párrafos y tablas", async () => {
    expect(sequenceMatcherRatio("abcdef", "abcdfg")).toBeCloseTo(2 * 5 / 12, 4);

    const catalogo = new Map<string, string[]>([
      ["101", ["Whey Protein Vainilla 1kg"]],
      ["102", ["Whey Protein Chocolate 1kg"]],
      ["201", ["UT Creatine Monohidrato 300 g"]],
    ]);

    expect(
      buscarCodigoPorDescripcionMl("Ultra Tech Creatina 300 grs", catalogo).codigo
    ).toBe("201");
    // Conflicto de sabor no debe emparejar Vainilla contra Chocolate
    expect(
      buscarCodigoPorDescripcionMl("Whey Protein Chocolate 1kg", catalogo).codigo
    ).toBe("102");
    expect(
      buscarCodigoPorDescripcionMl("Whey Protein Frutilla 1kg", catalogo).codigo
    ).toBeNull();

    const docxBuf = await buildDocxBuffer({
      paragraphs: ["2) Ultra Tech Creatina Monohidrato 300 grs"],
      tables: [
        [
          ["3", "Whey Protein Vainilla 1kg", "3", "Whey Protein Vainilla 1kg"],
          ["1 Producto Totalmente Desconocido 999", ""],
        ],
      ],
    });

    const parsedDocx = await parsearPedidoMercadoLibreDocx(docxBuf, "orden_77.docx", [
      { codigo: "101", nombre: "Whey Protein Vainilla 1kg" },
      { codigo: "201", nombre: "UT Creatine Monohidrato 300 g" },
    ]);

    expect(parsedDocx.numeroRemito).toBe("ML-orden_77");
    expect(parsedDocx.articulosDeclarados).toBe(6);
    expect(parsedDocx.articulosExtraidos).toBe(5);
    expect(parsedDocx.verificacionOk).toBe(false);
    expect(parsedDocx.items).toEqual([
      {
        codigo: "201",
        descripcion: "Ultra Tech Creatina Monohidrato 300 grs",
        cantidad: 2,
        origenRemito: "ML-orden_77",
      },
      {
        codigo: "101",
        descripcion: "Whey Protein Vainilla 1kg",
        cantidad: 3,
        origenRemito: "ML-orden_77",
      },
    ]);
    expect(parsedDocx.descripcionesSinCoincidencia).toHaveLength(1);
  });

  it("parsearArchivoMercadoFull lee .xls (BIFF8) y .xlsx consolidando SKUs e ignorando totales", async () => {
    const xlsBuf = Buffer.from(SAMPLE_FULL_XLS_BASE64, "base64");
    const resXls = await parsearArchivoMercadoFull(xlsBuf, "envio_full_01.xls");
    expect(resXls.numeroDocumento).toBe("FULL-envio_full_01");
    expect(resXls.consolidado).toEqual({ "101": 7, "201": 3 });
    expect(resXls.totalUnidades).toBe(10);

    const xlsxBuf = await buildXlsxBuffer([
      ["Código Publicación", "Título", "Unidades a Enviar"],
      ["101", "Whey 1kg", 5],
      ["101", "Whey 1kg lote 2", 4],
      ["SUBTOTAL", "", 9],
    ]);
    const resXlsx = await parsearArchivoMercadoFull(xlsxBuf, "envio_full_02.xlsx");
    expect(resXlsx.consolidado).toEqual({ "101": 9 });
    expect(resXlsx.totalUnidades).toBe(9);
  });

  it("parsearArchivoFabrica soporta .xlsx y .pdf", async () => {
    const xlsxBuf = await buildXlsxBuffer([
      ["COD", "PRODUCTO", "INGRESO"],
      ["101", "Whey", 25],
      ["201", "Creatina", 15],
    ]);
    const resXlsx = await parsearArchivoFabrica(xlsxBuf, "lote_fabrica.xlsx");
    expect(resXlsx.consolidado).toEqual({ "101": 25, "201": 15 });
    expect(resXlsx.totalUnidades).toBe(40);

    const pdfBuf = buildMinimalPdfBuffer([
      "0009-00000100",
      "SUPPLEMENTS SRL",
      "101 PROTEINA WHEY 12",
      "DATOS LOGISTICA",
    ]);
    const resPdf = await parsearArchivoFabrica(pdfBuf, "remito_fabrica.pdf");
    expect(resPdf.numeroDocumento).toBe("0009-00000100");
    expect(resPdf.consolidado).toEqual({ "101": 12 });
  });

  it("parsearStockFisicoSpreadsheet prioriza columna Stock Físico y conserva ceros", async () => {
    const xlsxBuf = await buildXlsxBuffer([
      ["SKU", "PRODUCTO", "STOCK", "STOCK FISICO"],
      ["101", "Whey 1kg", 50, 0],
      ["201", "Creatina 300g", 8, 12],
      ["301", "Sin Contar", 10, ""],
      ["TOTAL", "", 68, 12],
    ]);

    const res = await parsearStockFisicoSpreadsheet(xlsxBuf, "conteo_nov.xlsx");
    expect(res.consolidado).toEqual({ "101": 0, "201": 12 });
    expect(res.totalUnidades).toBe(12);
    expect(res.detalle).toHaveLength(2);
  });
});

describe("Fase 3 - Endpoints HTTP upload-and-simulate + Mercado Libre OAuth/API", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stockagent-phase3-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function createHarness() {
    let products: Array<CatalogProductSnapshot & { tenantId: string; active: boolean }> = [
      {
        id: 1,
        tenantId: TENANT_A,
        code: "101",
        name: "Proteina Whey 1kg Vainilla",
        stock: 50,
        stockMinimo: 10,
        stockMaximo: 150,
        codBarras: "7791234567890",
        ubicacion: "A1",
        active: true,
      },
      {
        id: 2,
        tenantId: TENANT_A,
        code: "201",
        name: "UT Creatine Monohidrato 300 g",
        stock: 20,
        stockMinimo: 5,
        stockMaximo: 100,
        codBarras: "7791234567892",
        ubicacion: "B1",
        active: true,
      },
    ];
    let orders: Array<{
      id: number;
      tenantId: string;
      notaPedido: string;
      archivoHash: string;
      archivoDescuentoKey: string;
      estado: "descontado" | "anulado";
    }> = [];
    const storedFiles: Array<{
      id: string;
      tenantId: string;
      category: string;
      originalName: string;
      storageKey: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      uploadedBy: string;
      createdAt: Date;
    }> = [];
    const processedTx = new Set<string>();
    const mlConfigStore = new Map<string, Record<string, unknown>>();
    let seq = 1;

    const fakeDb = {
      transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
        cb({ execute: async () => undefined }),
    } as unknown as Database;

    const productRepo = {
      listProducts: async (scope: { tenantId: string }) =>
        products.filter((p) => p.tenantId === scope.tenantId && p.active),
      applyBatchDiscounts: async (
        scope: { tenantId: string },
        input: { items: Array<{ codigo: string; cantidad: number }> }
      ) => {
        let totalUnidades = 0;
        for (const item of input.items) {
          const p = products.find(
            (x) =>
              x.tenantId === scope.tenantId &&
              x.code.toLowerCase() === item.codigo.toLowerCase()
          );
          if (p) {
            p.stock -= item.cantidad;
            totalUnidades += item.cantidad;
          }
        }
        return { dispatchId: ++seq, totalUnidades, detalles: [] };
      },
    } as unknown as ProductRepository;

    const orderRepo = {
      findExistingOrdersByNotas: async (
        scope: { tenantId: string },
        notas: readonly string[]
      ) => {
        const lower = new Set(notas.map((n) => n.trim().toLowerCase()));
        return new Set(
          orders
            .filter(
              (o) =>
                o.tenantId === scope.tenantId &&
                lower.has(o.notaPedido.toLowerCase())
            )
            .map((o) => o.notaPedido)
        );
      },
      findConfirmedOrdersByHashes: async (
        scope: { tenantId: string },
        hashes: readonly string[]
      ) => {
        const map = new Map<string, string>();
        for (const o of orders) {
          if (
            o.tenantId === scope.tenantId &&
            o.estado === "descontado" &&
            hashes.includes(o.archivoHash)
          ) {
            map.set(o.archivoHash, o.notaPedido);
          }
        }
        return map;
      },
      registerIdempotentTx: async (
        scope: { tenantId: string },
        txId: string
      ) => {
        const k = `${scope.tenantId}:${txId}`;
        if (processedTx.has(k)) return false;
        processedTx.add(k);
        return true;
      },
      registerOrder: async (
        scope: { tenantId: string },
        input: {
          notaPedido: string;
          archivoHash?: string;
          archivoDescuentoKey?: string;
        }
      ) => {
        if (
          orders.some(
            (o) =>
              o.tenantId === scope.tenantId &&
              o.notaPedido.toLowerCase() === input.notaPedido.toLowerCase()
          )
        ) {
          throw new ConflictError(`Pedido '${input.notaPedido}' duplicado.`);
        }
        const created = {
          id: ++seq,
          tenantId: scope.tenantId,
          notaPedido: input.notaPedido,
          archivoHash: input.archivoHash ?? "",
          archivoDescuentoKey: input.archivoDescuentoKey ?? "",
          estado: "descontado" as const,
        };
        orders.push(created);
        return created;
      },
    } as unknown as OrderRepository;

    const auditRepo = {
      findStoredFileBySha256: async (
        scope: { tenantId: string },
        sha256: string
      ) =>
        storedFiles.find(
          (f) => f.tenantId === scope.tenantId && f.sha256 === sha256
        ) ?? null,
      registerStoredFile: async (
        scope: { tenantId: string },
        input: Omit<(typeof storedFiles)[number], "id" | "tenantId" | "createdAt">
      ) => {
        const row = {
          id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
          tenantId: scope.tenantId,
          ...input,
          createdAt: new Date(),
        };
        storedFiles.push(row);
        return row;
      },
      getStoredFileById: async (scope: { tenantId: string }, id: string) =>
        storedFiles.find((f) => f.tenantId === scope.tenantId && f.id === id) ??
        null,
      logAudit: async () => null,
    } as unknown as AuditChatRepository;

    const encryptionKey = "test-aes-key-for-ml-settings-32bytes!";
    const realRepo = new TenantSettingsRepository(encryptionKey);
    // Harness fake settings backed by real encrypt/decrypt logic in TenantSettingsRepository
    const settingsRepo = {
      getMercadoLibreConfig: async (scope: { tenantId: string }) => {
        const fakeTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: async () => {
                  const stored = mlConfigStore.get(scope.tenantId);
                  return stored ? [{ mercadolibreConfig: stored }] : [];
                },
              }),
            }),
          }),
        };
        return realRepo.getMercadoLibreConfig({
          db: fakeDb,
          tenantId: scope.tenantId,
          tx: fakeTx as never,
        });
      },
      saveMercadoLibreConfig: async (
        scope: { tenantId: string },
        patch: Record<string, unknown>
      ) => {
        const fakeTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: async () => {
                  const stored = mlConfigStore.get(scope.tenantId);
                  return stored ? [{ mercadolibreConfig: stored }] : [];
                },
              }),
            }),
          }),
          insert: () => ({
            values: (vals: { mercadolibreConfig: Record<string, unknown> }) => ({
              onConflictDoUpdate: async () => {
                mlConfigStore.set(scope.tenantId, vals.mercadolibreConfig);
              },
            }),
          }),
        };
        return realRepo.saveMercadoLibreConfig(
          { db: fakeDb, tenantId: scope.tenantId, tx: fakeTx as never },
          patch
        );
      },
    } as unknown as TenantSettingsRepository;

    return {
      fakeDb,
      productRepo,
      orderRepo,
      auditRepo,
      settingsRepo,
      mlConfigStore,
      encryptionKey,
      getProducts: () => products,
      getOrders: () => orders,
    };
  }

  it("POST /api/v1/parsers/upload-and-simulate sube PDF/XLSX, parsea y simula sin descontar hasta confirmar", async () => {
    const h = createHarness();
    const storage = new LocalStorageAdapter(tempDir);
    const fileService = new FileUploadService(storage, h.auditRepo, h.orderRepo);
    const ingestionService = new IngestionService(h.productRepo, h.orderRepo, h.auditRepo);
    const adminAuth: AuthContext = {
      tenantId: TENANT_A,
      userId: 1,
      username: "admin_a",
      role: "administrador",
      authType: "session",
    };

    const app = createApp({
      db: h.fakeDb,
      storage,
      authResolver: async () => adminAuth,
      fileService,
      ingestionService,
      productRepo: h.productRepo,
      settingsRepo: h.settingsRepo,
      logger: false,
    });

    try {
      const pdfBuf = buildMinimalPdfBuffer([
        "0001-00005555",
        "Cant. Articulos: 6",
        "1024 - GIMNASIO DEMO",
        "SUPPLEMENTS SRL",
        "101 Proteina Whey 1kg 4",
        "201 Creatina 300g 2",
        "DATOS LOGISTICA",
      ]);

      const form = new FormData();
      form.set("category", "remito_mayorista");
      form.append("file", new Blob([new Uint8Array(pdfBuf)], { type: "application/pdf" }), "remito_5555.pdf");
      const enc = await encodeFormData(form);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/parsers/upload-and-simulate",
        headers: { "content-type": enc.contentType },
        payload: enc.body,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.operation).toBe("descuento_pedidos");
      expect(body.simulation.canConfirm).toBe(true);
      expect(body.simulation.totalUnidades).toBe(6);
      // Simulación NO modificó stock
      expect(h.getProducts()[0]?.stock).toBe(50);

      // Re-parseo de archivo ya guardado por UUID
      const fileId = body.uploadedFiles[0].file.id as string;
      const reparse = await app.inject({
        method: "POST",
        url: "/api/v1/parsers/parse-stored",
        payload: { fileIds: [fileId], simulate: true },
      });
      expect(reparse.statusCode).toBe(200);
      expect(reparse.json().simulation.totalUnidades).toBe(6);

      // Confirmación final aplica descuento
      const docInput = body.parsedDocuments[0].document;
      const confirmRes = await app.inject({
        method: "POST",
        url: "/api/v1/ingestion/confirm",
        payload: {
          operation: "descuento_pedidos",
          documents: [docInput],
        },
      });
      expect(confirmRes.statusCode).toBe(201);
      expect(h.getProducts()[0]?.stock).toBe(46);
      expect(h.getProducts()[1]?.stock).toBe(18);
    } finally {
      await app.close();
    }
  });

  it("MercadoLibreService cifra secretos en tenant_settings, renueva token 401 y sincroniza órdenes idempotentes", async () => {
    const h = createHarness();
    const storage = new LocalStorageAdapter(tempDir);
    const fileService = new FileUploadService(storage, h.auditRepo, h.orderRepo);
    const ingestionService = new IngestionService(h.productRepo, h.orderRepo, h.auditRepo);

    let currentAccess = "expired_tok_1";
    const mockFetch: typeof fetch = async (input, init) => {
      const url = input.toString();
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";

      if (url.endsWith("/oauth/token")) {
        const rawBody = String(init?.body ?? "");
        if (rawBody.includes("grant_type=authorization_code")) {
          return new Response(
            JSON.stringify({
              access_token: "expired_tok_1",
              refresh_token: "refresh_tok_1",
              user_id: 987654,
              expires_in: 21600,
            }),
            { status: 200 }
          );
        }
        currentAccess = "fresh_tok_2";
        return new Response(
          JSON.stringify({
            access_token: "fresh_tok_2",
            refresh_token: "refresh_tok_2",
            user_id: 987654,
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/users/me")) {
        if (auth !== `Bearer ${currentAccess}` || auth === "Bearer expired_tok_1") {
          return new Response("unauthorized", { status: 401 });
        }
        return new Response(
          JSON.stringify({ id: 987654, nickname: "TIENDA_FITNESS_ML" }),
          { status: 200 }
        );
      }

      if (url.includes("/orders/search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 2000112233,
                date_created: "2026-11-17T14:00:00.000-03:00",
                buyer: { first_name: "Ana", last_name: "Lopez" },
                shipping: { id: 440011 },
                order_items: [
                  {
                    quantity: 3,
                    unit_price: 45000,
                    item: { title: "Whey", seller_sku: "101" },
                  },
                  {
                    quantity: 2,
                    unit_price: 28000,
                    item: { title: "Ultra Tech Creatina Monohidrato 300 grs" },
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response("not found", { status: 404 });
    };

    const mlService = new MercadoLibreService(
      h.settingsRepo,
      h.productRepo,
      h.orderRepo,
      { fetchFn: mockFetch }
    );

    const adminAuth: AuthContext = {
      tenantId: TENANT_A,
      userId: 1,
      username: "admin_a",
      role: "administrador",
      authType: "session",
    };

    const app = createApp({
      db: h.fakeDb,
      storage,
      authResolver: async () => adminAuth,
      fileService,
      ingestionService,
      productRepo: h.productRepo,
      settingsRepo: h.settingsRepo,
      mercadoLibreService: mlService,
      logger: false,
    });

    try {
      // 1. Guardar config y verificar cifrado AES-256-GCM en tenant_settings + máscara HTTP
      const putCfg = await app.inject({
        method: "PUT",
        url: "/api/v1/integrations/mercadolibre/config",
        payload: {
          appId: "123456789",
          clientSecret: "super-ml-secret",
          activo: true,
        },
      });
      expect(putCfg.statusCode).toBe(200);
      expect(putCfg.json().config.hasClientSecret).toBe(true);
      expect(putCfg.json().config.clientSecret).toBeUndefined();

      const rawSaved = h.mlConfigStore.get(TENANT_A)!;
      expect(isEncryptedSecret(String(rawSaved.clientSecret))).toBe(true);
      expect(decryptSecret(String(rawSaved.clientSecret), h.encryptionKey)).toBe(
        "super-ml-secret"
      );

      // 2. Generar URL OAuth y canjear code
      const oauthUrlRes = await app.inject({
        method: "GET",
        url: "/api/v1/integrations/mercadolibre/oauth-url?redirectUri=https://app.stockagent.test/callback&state=xyz",
      });
      expect(oauthUrlRes.statusCode).toBe(200);
      expect(oauthUrlRes.json().url).toContain("client_id=123456789");

      const callbackRes = await app.inject({
        method: "POST",
        url: "/api/v1/integrations/mercadolibre/oauth-callback",
        payload: {
          code: "TG-AUTH-CODE-1",
          redirectUri: "https://app.stockagent.test/callback",
        },
      });
      expect(callbackRes.statusCode).toBe(200);
      expect(callbackRes.json().sellerId).toBe("987654");

      // 3. Verify renueva automáticamente access_token ante 401
      const verifyRes = await app.inject({
        method: "POST",
        url: "/api/v1/integrations/mercadolibre/verify",
      });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json().nickname).toBe("TIENDA_FITNESS_ML");
      expect(
        decryptSecret(
          String(h.mlConfigStore.get(TENANT_A)!.accessToken),
          h.encryptionKey
        )
      ).toBe("fresh_tok_2");

      // 4. Sincronizar órdenes en modo simulación primero
      const syncSim = await app.inject({
        method: "POST",
        url: "/api/v1/integrations/mercadolibre/orders/sync",
        payload: { simulateOnly: true },
      });
      expect(syncSim.statusCode).toBe(200);
      expect(syncSim.json().mappedOrders).toHaveLength(1);
      expect(syncSim.json().simulation.totalUnidades).toBe(5);
      expect(h.getProducts()[0]?.stock).toBe(50);

      // 5. Sincronizar y descontar atómicamente
      const syncConfirm = await app.inject({
        method: "POST",
        url: "/api/v1/integrations/mercadolibre/orders/sync",
        payload: { simulateOnly: false },
      });
      expect(syncConfirm.statusCode).toBe(200);
      expect(syncConfirm.json().confirmResult.totalUnidadesAplicadas).toBe(5);
      expect(h.getProducts()[0]?.stock).toBe(47);
      expect(h.getProducts()[1]?.stock).toBe(18);
      expect(h.getOrders()[0]?.archivoHash).toBe(
        hashSha256("ML_API_ORDER_2000112233")
      );

      // 6. Segunda sincronización omite automáticamente la orden ya descontada
      const syncAgain = await app.inject({
        method: "POST",
        url: "/api/v1/integrations/mercadolibre/orders/sync",
        payload: { simulateOnly: false },
      });
      expect(syncAgain.statusCode).toBe(200);
      expect(syncAgain.json().skippedAlreadyProcessed).toEqual(["ML-2000112233"]);
      expect(syncAgain.json().mappedOrders).toHaveLength(0);
      expect(h.getProducts()[0]?.stock).toBe(47);
    } finally {
      await app.close();
    }
  });

  it("mapMercadoLibreOrderToDocument prioriza SKU y usa fallback fuzzy de título", () => {
    const mapped = mapMercadoLibreOrderToDocument(
      {
        id: 555,
        buyer: { nickname: "COMPRADOR_ML" },
        order_items: [
          { quantity: 2, unit_price: 100, item: { seller_sku: "101", title: "Otra cosa" } },
          { quantity: 1, unit_price: 200, item: { title: "UT Creatine 300g" } },
        ],
      },
      [
        {
          id: 1,
          code: "101",
          name: "Proteina Whey 1kg",
          stock: 10,
          stockMinimo: 2,
          stockMaximo: 50,
          codBarras: "",
          ubicacion: "",
        },
        {
          id: 2,
          code: "201",
          name: "UT Creatine Monohidrato 300 g",
          stock: 5,
          stockMinimo: 2,
          stockMaximo: 50,
          codBarras: "",
          ubicacion: "",
        },
      ]
    );
    expect(mapped.todosCoinciden).toBe(true);
    expect(mapped.itemsCoincidentes[0]?.metodo).toBe("SKU");
    expect(mapped.itemsCoincidentes[1]?.metodo).toBe("Fuzzy Título");
    expect(normalizarCodigo(mapped.itemsCoincidentes[1]?.codigo)).toBe("201");
  });
});

import type {
  IngestionDocumentInput,
  IngestionOperation,
} from "@stockagent/shared";

export interface ParsedRemitoItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  origenRemito: string;
}

export interface ParsedRemitoResult {
  archivo: string;
  numeroRemito: string;
  fecha: string;
  cliente: string;
  articulosDeclarados: number | null;
  articulosExtraidos: number;
  verificacionOk: boolean;
  items: ParsedRemitoItem[];
  descripcionesSinCoincidencia: Array<[string, string]>;
  discrepancia: boolean;
  codigoCliente: string;
  direccion: string;
  fechaDespacho: string;
}

export interface ParsedSpreadsheetDetail {
  codigo: string;
  descripcion: string;
  cantidad: number;
}

export interface ParsedSpreadsheetSummary {
  archivo: string;
  numeroDocumento: string;
  consolidado: Record<string, number>;
  detalle: ParsedSpreadsheetDetail[];
  totalUnidades: number;
}

export interface ParsedDocumentEnvelope {
  suggestedOperation: IngestionOperation;
  document: IngestionDocumentInput;
  parsedMeta: ParsedRemitoResult | ParsedSpreadsheetSummary;
}

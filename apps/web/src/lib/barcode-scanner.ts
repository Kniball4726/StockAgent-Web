import { normalizarCodigoLector } from "@stockagent/shared";

/**
 * Extrae el identificador o nota de pedido desde un QR que puede venir como texto plano,
 * JSON (`{"nota_pedido":"..."}` / `{"codigo":"..."}`) o URL con query params.
 */
export function extraerCodigoDespacho(raw: string): string {
  const cleaned = normalizarCodigoLector(raw);
  if (!cleaned) {
    return "";
  }

  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const candidate =
        parsed.nota_pedido ?? parsed.codigo ?? parsed.order_id ?? parsed.id;
      if (typeof candidate === "string" || typeof candidate === "number") {
        return normalizarCodigoLector(String(candidate));
      }
    } catch {
      // Continuar como texto plano si el JSON está truncado
    }
  }

  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const url = new URL(cleaned);
      const param =
        url.searchParams.get("nota_pedido") ??
        url.searchParams.get("codigo") ??
        url.searchParams.get("order") ??
        url.searchParams.get("id");
      if (param) {
        return normalizarCodigoLector(param);
      }
    } catch {
      // Fallback a texto plano
    }
  }

  return cleaned;
}

export interface BrowserBarcodeMatch {
  rawValue?: string;
}

export interface BrowserBarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<BrowserBarcodeMatch[]>;
}

export function isCameraBarcodeScannerSupported(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const hasCamera =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
  const hasDetector = "BarcodeDetector" in window;
  return hasCamera && hasDetector;
}

export async function createBrowserBarcodeDetector(
  formats: string[] = [
    "qr_code",
    "code_128",
    "code_39",
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
  ]
): Promise<BrowserBarcodeDetectorLike | null> {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) {
    return null;
  }
  const Ctor = (
    window as unknown as {
      BarcodeDetector: new (opts?: {
        formats?: string[];
      }) => BrowserBarcodeDetectorLike;
    }
  ).BarcodeDetector;
  return new Ctor({ formats });
}

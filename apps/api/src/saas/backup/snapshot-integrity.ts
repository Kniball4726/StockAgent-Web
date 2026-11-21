import { hashSha256 } from "../../security/crypto.js";

export interface TenantSnapshotPayload {
  products: Array<{
    code: string;
    name: string;
    stock: number;
    stockFisico: number;
    stockMinimo: number;
    stockMaximo: number;
    codBarras: string;
    ubicacion: string;
    active: boolean;
  }>;
  customers: Array<{
    nombre: string;
    codigo: string;
    direccion: string;
    activo: boolean;
  }>;
  orders: Array<{
    notaPedido: string;
    numeroPedido: string;
    cliente: string;
    bultos: number;
    logistica: string;
    armador: string;
    tipoArchivo: string;
    nombreArchivo: string;
    estado: string;
    fechaRetiro: string;
    archivoHash: string;
    numeroGuia: string;
    estadoDespacho: string;
    canal: string;
    articulosDescontados: number;
    resumenItems: string;
    items: Array<{
      codigo: string;
      descripcion: string;
      cantidad: number;
    }>;
  }>;
  stockMovements: Array<{
    productCode: string;
    productName: string;
    quantity: number;
    movementType: string;
    usuario: string;
    detalle: string;
    registeredAt: string;
  }>;
  storedFiles: Array<{
    id: string;
    category: string;
    originalName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    uploadedBy: string;
    createdAt: string;
  }>;
  auditLogs: Array<{
    usuario: string;
    accion: string;
    detalle: string;
    createdAt: string;
  }>;
  chatMessages: Array<{
    emisor: string;
    destinatario: string;
    mensaje: string;
    leido: boolean;
    createdAt: string;
  }>;
}

export interface SignedTenantSnapshot {
  formatVersion: 1;
  tenantId: string;
  tenantSlug: string;
  exportedAt: string;
  counts: {
    products: number;
    customers: number;
    orders: number;
    stockMovements: number;
    storedFiles: number;
    auditLogs: number;
    chatMessages: number;
  };
  data: TenantSnapshotPayload;
  sha256Checksum: string;
}

export function computeSnapshotChecksum(
  payload: Omit<SignedTenantSnapshot, "sha256Checksum">
): string {
  const canonical = JSON.stringify({
    formatVersion: payload.formatVersion,
    tenantId: payload.tenantId,
    tenantSlug: payload.tenantSlug,
    exportedAt: payload.exportedAt,
    counts: payload.counts,
    data: payload.data,
  });
  return hashSha256(canonical);
}

export function createSignedTenantSnapshot(params: {
  tenantId: string;
  tenantSlug: string;
  exportedAt?: string;
  data: TenantSnapshotPayload;
}): SignedTenantSnapshot {
  const base: Omit<SignedTenantSnapshot, "sha256Checksum"> = {
    formatVersion: 1,
    tenantId: params.tenantId,
    tenantSlug: params.tenantSlug,
    exportedAt: params.exportedAt ?? new Date().toISOString(),
    counts: {
      products: params.data.products.length,
      customers: params.data.customers.length,
      orders: params.data.orders.length,
      stockMovements: params.data.stockMovements.length,
      storedFiles: params.data.storedFiles.length,
      auditLogs: params.data.auditLogs.length,
      chatMessages: params.data.chatMessages.length,
    },
    data: params.data,
  };

  return {
    ...base,
    sha256Checksum: computeSnapshotChecksum(base),
  };
}

export function verifyTenantSnapshotIntegrity(raw: unknown): {
  valid: boolean;
  reason?: string;
  snapshot?: SignedTenantSnapshot;
} {
  if (!raw || typeof raw !== "object") {
    return { valid: false, reason: "El snapshot no es un objeto JSON válido." };
  }
  const obj = raw as Partial<SignedTenantSnapshot>;
  if (
    obj.formatVersion !== 1 ||
    typeof obj.tenantId !== "string" ||
    typeof obj.tenantSlug !== "string" ||
    typeof obj.exportedAt !== "string" ||
    typeof obj.sha256Checksum !== "string" ||
    !obj.counts ||
    !obj.data
  ) {
    return {
      valid: false,
      reason: "Faltan metadatos obligatorios en el backup.",
    };
  }

  const expected = computeSnapshotChecksum({
    formatVersion: 1,
    tenantId: obj.tenantId,
    tenantSlug: obj.tenantSlug,
    exportedAt: obj.exportedAt,
    counts: obj.counts,
    data: obj.data,
  });

  if (expected !== obj.sha256Checksum) {
    return {
      valid: false,
      reason:
        "Checksum SHA-256 inválido: el archivo de backup fue modificado o está corrupto.",
    };
  }

  return { valid: true, snapshot: obj as SignedTenantSnapshot };
}

import { asc, eq } from "drizzle-orm";
import { withTenantTransaction, type Database } from "../db/client.js";
import {
  auditLogs,
  chatMessages,
  customers,
  orderItems,
  orders,
  products,
  stockMovements,
  storedFiles,
  tenants,
} from "../db/schema/index.js";
import { ConflictError, NotFoundError } from "../repositories/base.js";
import { hashSha256 } from "../security/crypto.js";

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
    return { valid: false, reason: "Faltan metadatos obligatorios en el backup." };
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

export class TenantBackupService {
  constructor(private readonly db: Database) {}

  async exportTenantSnapshot(tenantId: string): Promise<SignedTenantSnapshot> {
    const [tenantRow] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenantRow) {
      throw new NotFoundError("Tenant no encontrado para backup.");
    }

    const data = await withTenantTransaction(
      this.db,
      tenantId,
      async (tx, validTenantId): Promise<TenantSnapshotPayload> => {
        const [prodRows, custRows, orderRows, itemRows, movRows, fileRows, logRows, chatRows] =
          await Promise.all([
            tx
              .select()
              .from(products)
              .where(eq(products.tenantId, validTenantId))
              .orderBy(asc(products.id)),
            tx
              .select()
              .from(customers)
              .where(eq(customers.tenantId, validTenantId))
              .orderBy(asc(customers.id)),
            tx
              .select()
              .from(orders)
              .where(eq(orders.tenantId, validTenantId))
              .orderBy(asc(orders.id)),
            tx
              .select()
              .from(orderItems)
              .where(eq(orderItems.tenantId, validTenantId))
              .orderBy(asc(orderItems.id)),
            tx
              .select()
              .from(stockMovements)
              .where(eq(stockMovements.tenantId, validTenantId))
              .orderBy(asc(stockMovements.id)),
            tx
              .select()
              .from(storedFiles)
              .where(eq(storedFiles.tenantId, validTenantId))
              .orderBy(asc(storedFiles.createdAt)),
            tx
              .select()
              .from(auditLogs)
              .where(eq(auditLogs.tenantId, validTenantId))
              .orderBy(asc(auditLogs.id)),
            tx
              .select()
              .from(chatMessages)
              .where(eq(chatMessages.tenantId, validTenantId))
              .orderBy(asc(chatMessages.id)),
          ]);

        const itemsByOrderId = new Map<
          number,
          Array<{ codigo: string; descripcion: string; cantidad: number }>
        >();
        for (const it of itemRows) {
          const list = itemsByOrderId.get(it.orderId) ?? [];
          list.push({
            codigo: it.codigo,
            descripcion: it.descripcion,
            cantidad: it.cantidad,
          });
          itemsByOrderId.set(it.orderId, list);
        }

        return {
          products: prodRows.map((p) => ({
            code: p.code,
            name: p.name,
            stock: p.stock,
            stockFisico: p.stockFisico ?? p.stock,
            stockMinimo: p.stockMinimo,
            stockMaximo: p.stockMaximo,
            codBarras: p.codBarras,
            ubicacion: p.ubicacion,
            active: p.active,
          })),
          customers: custRows.map((c) => ({
            nombre: c.nombre,
            codigo: c.codigo,
            direccion: c.direccion,
            activo: c.activo,
          })),
          orders: orderRows.map((o) => ({
            notaPedido: o.notaPedido,
            numeroPedido: o.numeroPedido,
            cliente: o.cliente,
            bultos: o.bultos,
            logistica: o.logistica,
            armador: o.armador,
            tipoArchivo: o.tipoArchivo,
            nombreArchivo: o.nombreArchivo,
            estado: o.estado,
            fechaRetiro: o.fechaRetiro,
            archivoHash: o.archivoHash,
            numeroGuia: o.numeroGuia,
            estadoDespacho: o.estadoDespacho,
            canal: o.canal,
            articulosDescontados: o.articulosDescontados,
            resumenItems: o.resumenItems,
            items: itemsByOrderId.get(o.id) ?? [],
          })),
          stockMovements: movRows.map((m) => ({
            productCode: m.productCode,
            productName: m.productName,
            quantity: m.quantity,
            movementType: m.movementType,
            usuario: m.usuario,
            detalle: m.detalle,
            registeredAt: m.registeredAt.toISOString(),
          })),
          storedFiles: fileRows.map((f) => ({
            id: f.id,
            category: f.category,
            originalName: f.originalName,
            storageKey: f.storageKey,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            sha256: f.sha256,
            uploadedBy: f.uploadedBy,
            createdAt: f.createdAt.toISOString(),
          })),
          auditLogs: logRows.map((l) => ({
            usuario: l.usuario,
            accion: l.accion,
            detalle: l.detalle,
            createdAt: l.createdAt.toISOString(),
          })),
          chatMessages: chatRows.map((c) => ({
            emisor: c.emisor,
            destinatario: c.destinatario,
            mensaje: c.mensaje,
            leido: c.leido,
            createdAt: c.createdAt.toISOString(),
          })),
        };
      }
    );

    return createSignedTenantSnapshot({
      tenantId: tenantRow.id,
      tenantSlug: tenantRow.slug,
      data,
    });
  }

  /**
   * Restaura productos y clientes desde un snapshot verificado dentro de una única transacción RLS,
   * remapeando siempre `tenantId` al tenant destino autorizado (evita inyección cross-tenant).
   */
  async restoreProductsIntoTenant(
    targetTenantId: string,
    rawSnapshot: unknown
  ): Promise<{ productsRestored: number; customersRestored: number }> {
    const check = verifyTenantSnapshotIntegrity(rawSnapshot);
    if (!check.valid || !check.snapshot) {
      throw new ConflictError(check.reason ?? "Backup corrupto o alterado.");
    }

    const snapshot = check.snapshot;
    return withTenantTransaction(
      this.db,
      targetTenantId,
      async (tx, validTenantId) => {
        let productsRestored = 0;
        for (const p of snapshot.data.products) {
          await tx
            .insert(products)
            .values({
              tenantId: validTenantId,
              code: p.code,
              name: p.name,
              stock: p.stock,
              stockFisico: p.stockFisico,
              stockMinimo: p.stockMinimo,
              stockMaximo: p.stockMaximo,
              codBarras: p.codBarras,
              ubicacion: p.ubicacion,
              active: p.active,
            })
            .onConflictDoNothing();
          productsRestored += 1;
        }

        let customersRestored = 0;
        for (const c of snapshot.data.customers) {
          await tx
            .insert(customers)
            .values({
              tenantId: validTenantId,
              nombre: c.nombre,
              codigo: c.codigo,
              direccion: c.direccion,
              activo: c.activo,
            })
            .onConflictDoNothing();
          customersRestored += 1;
        }

        return { productsRestored, customersRestored };
      }
    );
  }
}

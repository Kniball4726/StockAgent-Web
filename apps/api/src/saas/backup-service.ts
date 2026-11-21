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
import {
  computeSnapshotChecksum,
  createSignedTenantSnapshot,
  verifyTenantSnapshotIntegrity,
  type SignedTenantSnapshot,
  type TenantSnapshotPayload,
} from "./backup/snapshot-integrity.js";

export {
  computeSnapshotChecksum,
  createSignedTenantSnapshot,
  verifyTenantSnapshotIntegrity,
  type SignedTenantSnapshot,
  type TenantSnapshotPayload,
};

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
        const [
          prodRows,
          custRows,
          orderRows,
          itemRows,
          movRows,
          fileRows,
          logRows,
          chatRows,
        ] = await Promise.all([
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

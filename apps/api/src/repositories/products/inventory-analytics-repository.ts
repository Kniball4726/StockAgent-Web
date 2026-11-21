import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { InventoryHealthState } from "@stockagent/shared";
import {
  adminNotifications,
  products,
  stockMovements,
} from "../../db/schema/index.js";
import { runInTenantTx, type TenantScope } from "../base.js";

export interface ReplenishmentItem {
  id: number;
  code: string;
  name: string;
  stock: number;
  stockMinimo: number;
  stockMaximo: number;
  ubicacion: string;
  estadoInventario: InventoryHealthState;
  cantidadSugeridaPedir: number;
}

export class InventoryAnalyticsRepository {
  async getReplenishmentAnalysis(
    scope: TenantScope,
    onlyCritical = true
  ): Promise<ReplenishmentItem[]> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const whereClause = onlyCritical
        ? and(
            eq(products.tenantId, tenantId),
            eq(products.active, true),
            lte(products.stock, products.stockMinimo)
          )
        : and(eq(products.tenantId, tenantId), eq(products.active, true));

      const rows = await tx
        .select()
        .from(products)
        .where(whereClause)
        .orderBy(asc(products.stock), asc(products.code));

      return rows.map((p) => {
        let estadoInventario: InventoryHealthState = "OPTIMO";
        if (p.stock <= 0) {
          estadoInventario = "AGOTADO";
        } else if (p.stock <= p.stockMinimo) {
          estadoInventario = "QUIEBRE_INMINENTE";
        } else if (p.stock > p.stockMaximo) {
          estadoInventario = "SOBRESTOCK";
        }
        const cantidadSugeridaPedir =
          p.stock <= p.stockMinimo ? Math.max(0, p.stockMaximo - p.stock) : 0;

        return {
          id: p.id,
          code: p.code,
          name: p.name,
          stock: p.stock,
          stockMinimo: p.stockMinimo,
          stockMaximo: p.stockMaximo,
          ubicacion: p.ubicacion,
          estadoInventario,
          cantidadSugeridaPedir,
        };
      });
    });
  }

  async listRecentMovements(scope: TenantScope, limit = 150) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      return tx
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.tenantId, tenantId))
        .orderBy(desc(stockMovements.id))
        .limit(limit);
    });
  }

  async listAdminNotifications(
    scope: TenantScope,
    unreadOnly = false,
    limit = 50
  ) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const whereClause = unreadOnly
        ? and(
            eq(adminNotifications.tenantId, tenantId),
            eq(adminNotifications.isRead, false)
          )
        : eq(adminNotifications.tenantId, tenantId);
      return tx
        .select()
        .from(adminNotifications)
        .where(whereClause)
        .orderBy(desc(adminNotifications.id))
        .limit(limit);
    });
  }

  async markNotificationsRead(
    scope: TenantScope,
    notificationId?: number
  ): Promise<void> {
    await runInTenantTx(scope, async (tx, tenantId) => {
      const condition =
        notificationId !== undefined
          ? and(
              eq(adminNotifications.tenantId, tenantId),
              eq(adminNotifications.id, notificationId)
            )
          : and(
              eq(adminNotifications.tenantId, tenantId),
              eq(adminNotifications.isRead, false)
            );
      await tx.update(adminNotifications).set({ isRead: true }).where(condition);
    });
  }
}

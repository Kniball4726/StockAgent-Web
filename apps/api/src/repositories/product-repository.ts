import type { TenantScope } from "./base.js";
import {
  InventoryAnalyticsRepository,
  type ReplenishmentItem,
} from "./products/inventory-analytics-repository.js";
import {
  ProductCatalogRepository,
  type ProductRecord,
} from "./products/product-catalog-repository.js";
import {
  StockOperationsRepository,
  type BatchDiscountEntry,
} from "./products/stock-operations-repository.js";

export {
  InventoryAnalyticsRepository,
  ProductCatalogRepository,
  StockOperationsRepository,
  type BatchDiscountEntry,
  type ProductRecord,
  type ReplenishmentItem,
};

/**
 * Fachada compatible hacia atrás que delega en repositorios especializados
 * (catálogo, operaciones de stock e inventario/analítica).
 */
export class ProductRepository {
  private readonly catalog = new ProductCatalogRepository();
  private readonly stockOps = new StockOperationsRepository();
  private readonly analytics = new InventoryAnalyticsRepository();

  listProducts(scope: TenantScope, onlyActive = true): Promise<ProductRecord[]> {
    return this.catalog.listProducts(scope, onlyActive);
  }

  searchProducts(
    scope: TenantScope,
    term: string,
    limit = 50
  ): Promise<ProductRecord[]> {
    return this.catalog.searchProducts(scope, term, limit);
  }

  findProductByCodeOrBarcode(
    scope: TenantScope,
    rawQuery: string
  ): Promise<ProductRecord | null> {
    return this.catalog.findProductByCodeOrBarcode(scope, rawQuery);
  }

  createOrUpdateProduct(
    scope: TenantScope,
    input: Parameters<ProductCatalogRepository["createOrUpdateProduct"]>[1]
  ): Promise<ProductRecord> {
    return this.catalog.createOrUpdateProduct(scope, input);
  }

  updateLocation(
    scope: TenantScope,
    code: string,
    ubicacion: string
  ): Promise<ProductRecord> {
    return this.catalog.updateLocation(scope, code, ubicacion);
  }

  setBarcode(
    scope: TenantScope,
    code: string,
    codBarras: string
  ): Promise<ProductRecord> {
    return this.catalog.setBarcode(scope, code, codBarras);
  }

  adjustStockAtomic(
    scope: TenantScope,
    input: Parameters<StockOperationsRepository["adjustStockAtomic"]>[1]
  ) {
    return this.stockOps.adjustStockAtomic(scope, input);
  }

  applyBatchDiscounts(
    scope: TenantScope,
    input: Parameters<StockOperationsRepository["applyBatchDiscounts"]>[1]
  ) {
    return this.stockOps.applyBatchDiscounts(scope, input);
  }

  recordPhysicalInventory(
    scope: TenantScope,
    input: Parameters<StockOperationsRepository["recordPhysicalInventory"]>[1]
  ) {
    return this.stockOps.recordPhysicalInventory(scope, input);
  }

  getReplenishmentAnalysis(
    scope: TenantScope,
    onlyCritical = true
  ): Promise<ReplenishmentItem[]> {
    return this.analytics.getReplenishmentAnalysis(scope, onlyCritical);
  }

  listRecentMovements(scope: TenantScope, limit = 150) {
    return this.analytics.listRecentMovements(scope, limit);
  }

  listAdminNotifications(
    scope: TenantScope,
    unreadOnly = false,
    limit = 50
  ) {
    return this.analytics.listAdminNotifications(scope, unreadOnly, limit);
  }

  markNotificationsRead(
    scope: TenantScope,
    notificationId?: number
  ): Promise<void> {
    return this.analytics.markNotificationsRead(scope, notificationId);
  }
}

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { MOVEMENT_TYPES } from "@stockagent/shared";
import { tenants } from "./tenancy-auth.js";

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    stock: integer("stock").notNull().default(0),
    stockMinimo: integer("stock_minimo").notNull().default(5),
    stockMaximo: integer("stock_maximo").notNull().default(100),
    stockFisico: integer("stock_fisico"),
    codBarras: text("cod_barras").notNull().default(""),
    ubicacion: text("ubicacion").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_products_tenant_code_lower").on(
      t.tenantId,
      sql`lower(${t.code})`
    ),
    index("idx_products_tenant_barcode").on(t.tenantId, t.codBarras),
    index("idx_products_tenant_ubicacion").on(t.tenantId, t.ubicacion),
    index("idx_products_tenant_order").on(t.tenantId, t.displayOrder, t.id),
  ]
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull().default(""),
    quantity: integer("quantity").notNull(),
    movementType: text("movement_type", { enum: MOVEMENT_TYPES }).notNull(),
    usuario: text("usuario").notNull().default("sistema"),
    detalle: text("detalle").notNull().default(""),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_stock_movements_tenant_code").on(t.tenantId, t.productCode),
    index("idx_stock_movements_tenant_date").on(t.tenantId, t.registeredAt),
    index("idx_stock_movements_tenant_type").on(t.tenantId, t.movementType),
  ]
);

export const dispatches = pgTable(
  "dispatches",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
    tipoOrigen: text("tipo_origen").notNull(),
    nombreArchivo: text("nombre_archivo").notNull(),
    totalArticulos: integer("total_articulos").notNull().default(0),
    reporteArchivo: text("reporte_archivo").notNull().default(""),
    usuario: text("usuario").notNull().default("sistema"),
  },
  (t) => [index("idx_dispatches_tenant_fecha").on(t.tenantId, t.fecha)]
);

export const dispatchItems = pgTable(
  "dispatch_items",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dispatchId: integer("dispatch_id")
      .notNull()
      .references(() => dispatches.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    productCode: text("product_code").notNull(),
    cantidadDescontada: integer("cantidad_descontada").notNull(),
    stockAnterior: integer("stock_anterior").notNull(),
    stockNuevo: integer("stock_nuevo").notNull(),
  },
  (t) => [
    index("idx_dispatch_items_dispatch").on(t.dispatchId),
    index("idx_dispatch_items_tenant_code").on(t.tenantId, t.productCode),
  ]
);

export const physicalInventories = pgTable(
  "physical_inventories",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
    usuario: text("usuario").notNull().default("operador"),
    nombreArchivo: text("nombre_archivo").notNull(),
    reporteUnificado: text("reporte_unificado").notNull().default(""),
    totalRelevados: integer("total_relevados").notNull().default(0),
    totalDiferencias: integer("total_diferencias").notNull().default(0),
  },
  (t) => [index("idx_phys_inv_tenant_fecha").on(t.tenantId, t.fecha)]
);

export const physicalInventoryItems = pgTable(
  "physical_inventory_items",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    inventoryId: integer("inventory_id")
      .notNull()
      .references(() => physicalInventories.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull().default(""),
    stockDigital: integer("stock_digital").notNull(),
    stockFisico: integer("stock_fisico").notNull(),
    diferencia: integer("diferencia").notNull(),
    estado: text("estado").notNull(),
  },
  (t) => [index("idx_phys_inv_items_inv").on(t.inventoryId)]
);

export const adminNotifications = pgTable(
  "admin_notifications",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    operatorUsername: text("operator_username").notNull(),
    notificationType: text("notification_type").notNull().default("descuento"),
    details: text("details").notNull().default(""),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_admin_notif_tenant_read").on(t.tenantId, t.isRead)]
);

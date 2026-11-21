import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CANAL_PEDIDO_OPCIONES,
  ESTADOS_DESPACHO,
  LOGISTICA_OPCIONES,
  ORDER_FILE_TYPES,
  ORDER_STATUSES,
  PLAN_STATUSES,
} from "@stockagent/shared";
import { products } from "./inventory.js";
import { tenants } from "./tenancy-auth.js";

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    codigo: text("codigo").notNull().default(""),
    direccion: text("direccion").notNull().default(""),
    activo: boolean("activo").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_customers_tenant_nombre_lower").on(
      t.tenantId,
      sql`lower(${t.nombre})`
    ),
    index("idx_customers_tenant_codigo").on(t.tenantId, t.codigo),
  ]
);

export const shiftClosures = pgTable(
  "shift_closures",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    usuario: text("usuario").notNull(),
    cantidadPedidos: integer("cantidad_pedidos").notNull(),
    articulosTotales: integer("articulos_totales").notNull(),
    resumenPedidos: text("resumen_pedidos").notNull(),
    archivoPdfKey: text("archivo_pdf_key").notNull().default(""),
    archivoExcelKey: text("archivo_excel_key").notNull().default(""),
    archivoHojaRutaKey: text("archivo_hoja_ruta_key").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_shift_closures_tenant_created").on(t.tenantId, t.createdAt)]
);

export const marketClosures = pgTable(
  "market_closures",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    usuario: text("usuario").notNull(),
    tipoMercado: text("tipo_mercado").notNull().default("TODOS"),
    cantidadPedidos: integer("cantidad_pedidos").notNull(),
    articulosTotales: integer("articulos_totales").notNull(),
    resumenPedidos: text("resumen_pedidos").notNull(),
    archivoPdfKey: text("archivo_pdf_key").notNull().default(""),
    archivoExcelKey: text("archivo_excel_key").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_market_closures_tenant_created").on(t.tenantId, t.createdAt),
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    notaPedido: text("nota_pedido").notNull(),
    numeroPedido: text("numero_pedido").notNull().default(""),
    cliente: text("cliente").notNull(),
    bultos: integer("bultos").notNull().default(1),
    logistica: text("logistica", { enum: LOGISTICA_OPCIONES }).notNull(),
    armador: text("armador").notNull(),
    tipoArchivo: text("tipo_archivo", { enum: ORDER_FILE_TYPES }).notNull(),
    nombreArchivo: text("nombre_archivo").notNull().default(""),
    agregado: boolean("agregado").notNull().default(false),
    articulosDescontados: integer("articulos_descontados").notNull().default(0),
    resumenItems: text("resumen_items").notNull().default(""),
    estado: text("estado", { enum: ORDER_STATUSES })
      .notNull()
      .default("descontado"),
    fechaRetiro: text("fecha_retiro").notNull().default(""),
    archivoDescuentoKey: text("archivo_descuento_key").notNull().default(""),
    cierreId: integer("cierre_id").references(() => shiftClosures.id, {
      onDelete: "set null",
    }),
    cierreMercadoId: integer("cierre_mercado_id").references(
      () => marketClosures.id,
      { onDelete: "set null" }
    ),
    archivoHash: text("archivo_hash").notNull().default(""),
    numeroGuia: text("numero_guia").notNull().default(""),
    itemsSinCoincidencia: jsonb("items_sin_coincidencia")
      .$type<Array<[string, string]>>()
      .notNull()
      .default([]),
    estadoDespacho: text("estado_despacho", { enum: ESTADOS_DESPACHO })
      .notNull()
      .default("armado"),
    despachadoAt: timestamp("despachado_at", { withTimezone: true }),
    despachadoPor: text("despachado_por").notNull().default(""),
    entregadoAt: timestamp("entregado_at", { withTimezone: true }),
    entregadoPor: text("entregado_por").notNull().default(""),
    canal: text("canal", { enum: CANAL_PEDIDO_OPCIONES })
      .notNull()
      .default("mayorista"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("chk_orders_bultos_pos", sql`${t.bultos} >= 1`),
    uniqueIndex("uq_orders_tenant_nota_lower").on(
      t.tenantId,
      sql`lower(${t.notaPedido})`
    ),
    index("idx_orders_tenant_estado").on(t.tenantId, t.estado),
    index("idx_orders_tenant_cierre").on(t.tenantId, t.cierreId),
    index("idx_orders_tenant_cierre_mercado").on(t.tenantId, t.cierreMercadoId),
    index("idx_orders_tenant_despacho").on(t.tenantId, t.estadoDespacho),
    index("idx_orders_tenant_canal").on(t.tenantId, t.canal),
    index("idx_orders_tenant_hash").on(t.tenantId, t.archivoHash),
    index("idx_orders_tenant_created").on(t.tenantId, t.createdAt),
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull().default(""),
    cantidad: integer("cantidad").notNull(),
  },
  (t) => [
    check("chk_order_items_cantidad_pos", sql`${t.cantidad} > 0`),
    index("idx_order_items_order").on(t.orderId),
    index("idx_order_items_tenant_codigo").on(t.tenantId, t.codigo),
  ]
);

export const orderLocks = pgTable(
  "order_locks",
  {
    orderId: integer("order_id")
      .primaryKey()
      .references(() => orders.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    usuario: text("usuario").notNull(),
    bloqueadoAt: timestamp("bloqueado_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_order_locks_tenant_time").on(t.tenantId, t.bloqueadoAt)]
);

export const processedTransactions = pgTable(
  "processed_transactions",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    txId: text("tx_id").notNull(),
    accion: text("accion").notNull(),
    detalle: text("detalle").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.txId] }),
    index("idx_processed_tx_created").on(t.tenantId, t.createdAt),
  ]
);

export const fullPlans = pgTable(
  "full_plans",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    nombreEnvio: text("nombre_envio").notNull(),
    archivoOrigen: text("archivo_origen").notNull().default(""),
    creadoPor: text("creado_por").notNull(),
    estado: text("estado", { enum: PLAN_STATUSES })
      .notNull()
      .default("pendiente"),
    articulosTotales: integer("articulos_totales").notNull().default(0),
    articulosPickeados: integer("articulos_pickeados").notNull().default(0),
    porcentaje: doublePrecision("porcentaje").notNull().default(0),
    pickerAsignado: text("picker_asignado").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_full_plans_tenant_estado").on(t.tenantId, t.estado)]
);

export const fullPlanItems = pgTable(
  "full_plan_items",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: integer("plan_id")
      .notNull()
      .references(() => fullPlans.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull().default(""),
    cantidadSolicitada: integer("cantidad_solicitada").notNull(),
    cantidadPickeada: integer("cantidad_pickeada").notNull().default(0),
    completado: boolean("completado").notNull().default(false),
  },
  (t) => [
    index("idx_full_plan_items_plan").on(t.planId),
    index("idx_full_plan_items_plan_codigo").on(t.planId, t.codigo),
  ]
);

export const factoryPlans = pgTable(
  "factory_plans",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    nombreRemito: text("nombre_remito").notNull(),
    archivoRemito: text("archivo_remito").notNull().default(""),
    creadoPor: text("creado_por").notNull(),
    estado: text("estado", { enum: PLAN_STATUSES })
      .notNull()
      .default("pendiente"),
    articulosEsperados: integer("articulos_esperados").notNull().default(0),
    articulosControlados: integer("articulos_controlados").notNull().default(0),
    articulosIngresados: integer("articulos_ingresados").notNull().default(0),
    porcentaje: doublePrecision("porcentaje").notNull().default(0),
    pickerAsignado: text("picker_asignado").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_factory_plans_tenant_estado").on(t.tenantId, t.estado)]
);

export const factoryPlanItems = pgTable(
  "factory_plan_items",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: integer("plan_id")
      .notNull()
      .references(() => factoryPlans.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull().default(""),
    cantidadEsperada: integer("cantidad_esperada").notNull(),
    cantidadControlada: integer("cantidad_controlada").notNull().default(0),
    cantidadIngresada: integer("cantidad_ingresada").notNull().default(0),
    completado: boolean("completado").notNull().default(false),
  },
  (t) => [
    index("idx_factory_plan_items_plan").on(t.planId),
    index("idx_factory_plan_items_plan_codigo").on(t.planId, t.codigo),
  ]
);

export const factoryPartialClosures = pgTable(
  "factory_partial_closures",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: integer("plan_id")
      .notNull()
      .references(() => factoryPlans.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull().default("parcial"),
    picker: text("picker").notNull(),
    articulosIngresados: integer("articulos_ingresados").notNull().default(0),
    detalleItems: jsonb("detalle_items")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_factory_partial_closures_plan").on(t.planId)]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    usuario: text("usuario").notNull(),
    accion: text("accion").notNull(),
    detalle: text("detalle").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_audit_logs_tenant_created").on(t.tenantId, t.createdAt)]
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    emisor: text("emisor").notNull(),
    destinatario: text("destinatario").notNull().default("Todos"),
    mensaje: text("mensaje").notNull(),
    leido: boolean("leido").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_chat_messages_tenant_dest").on(
      t.tenantId,
      t.destinatario,
      t.leido
    ),
  ]
);

export const chatMessageReads = pgTable(
  "chat_message_reads",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    messageId: integer("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    usuario: text("usuario").notNull(),
    leidoAt: timestamp("leido_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.usuario] }),
    index("idx_chat_reads_tenant_usuario").on(
      t.tenantId,
      sql`lower(${t.usuario})`
    ),
  ]
);

export const storedFiles = pgTable(
  "stored_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    originalName: text("original_name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sha256: text("sha256").notNull().default(""),
    uploadedBy: text("uploaded_by").notNull().default("sistema"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_stored_files_tenant_sha").on(t.tenantId, t.sha256),
    uniqueIndex("uq_stored_files_key").on(t.storageKey),
  ]
);

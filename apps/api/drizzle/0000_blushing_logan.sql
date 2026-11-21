CREATE TABLE "api_keys" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"role" text DEFAULT 'operador' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"username" text NOT NULL,
	"role" text NOT NULL,
	"nombre" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"username" text NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"first_failed_at" timestamp with time zone,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"smtp_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"telegram_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mercadolibre_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"nombre" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"ui_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_status" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"operator_username" text NOT NULL,
	"notification_type" text DEFAULT 'descuento' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dispatch_id" integer NOT NULL,
	"product_id" integer,
	"product_code" text NOT NULL,
	"cantidad_descontada" integer NOT NULL,
	"stock_anterior" integer NOT NULL,
	"stock_nuevo" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"tipo_origen" text NOT NULL,
	"nombre_archivo" text NOT NULL,
	"total_articulos" integer DEFAULT 0 NOT NULL,
	"reporte_archivo" text DEFAULT '' NOT NULL,
	"usuario" text DEFAULT 'sistema' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physical_inventories" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario" text DEFAULT 'operador' NOT NULL,
	"nombre_archivo" text NOT NULL,
	"reporte_unificado" text DEFAULT '' NOT NULL,
	"total_relevados" integer DEFAULT 0 NOT NULL,
	"total_diferencias" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physical_inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inventory_id" integer NOT NULL,
	"product_id" integer,
	"product_code" text NOT NULL,
	"product_name" text DEFAULT '' NOT NULL,
	"stock_digital" integer NOT NULL,
	"stock_fisico" integer NOT NULL,
	"diferencia" integer NOT NULL,
	"estado" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"stock_minimo" integer DEFAULT 5 NOT NULL,
	"stock_maximo" integer DEFAULT 100 NOT NULL,
	"stock_fisico" integer,
	"cod_barras" text DEFAULT '' NOT NULL,
	"ubicacion" text DEFAULT '' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" integer,
	"product_code" text NOT NULL,
	"product_name" text DEFAULT '' NOT NULL,
	"quantity" integer NOT NULL,
	"movement_type" text NOT NULL,
	"usuario" text DEFAULT 'sistema' NOT NULL,
	"detalle" text DEFAULT '' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"usuario" text NOT NULL,
	"accion" text NOT NULL,
	"detalle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message_reads" (
	"tenant_id" uuid NOT NULL,
	"message_id" integer NOT NULL,
	"usuario" text NOT NULL,
	"leido_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_reads_message_id_usuario_pk" PRIMARY KEY("message_id","usuario")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"emisor" text NOT NULL,
	"destinatario" text DEFAULT 'Todos' NOT NULL,
	"mensaje" text NOT NULL,
	"leido" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"codigo" text DEFAULT '' NOT NULL,
	"direccion" text DEFAULT '' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_partial_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" integer NOT NULL,
	"tipo" text DEFAULT 'parcial' NOT NULL,
	"picker" text NOT NULL,
	"articulos_ingresados" integer DEFAULT 0 NOT NULL,
	"detalle_items" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_plan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" integer NOT NULL,
	"product_id" integer,
	"codigo" text NOT NULL,
	"descripcion" text DEFAULT '' NOT NULL,
	"cantidad_esperada" integer NOT NULL,
	"cantidad_controlada" integer DEFAULT 0 NOT NULL,
	"cantidad_ingresada" integer DEFAULT 0 NOT NULL,
	"completado" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nombre_remito" text NOT NULL,
	"archivo_remito" text DEFAULT '' NOT NULL,
	"creado_por" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"articulos_esperados" integer DEFAULT 0 NOT NULL,
	"articulos_controlados" integer DEFAULT 0 NOT NULL,
	"articulos_ingresados" integer DEFAULT 0 NOT NULL,
	"porcentaje" double precision DEFAULT 0 NOT NULL,
	"picker_asignado" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "full_plan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" integer NOT NULL,
	"product_id" integer,
	"codigo" text NOT NULL,
	"descripcion" text DEFAULT '' NOT NULL,
	"cantidad_solicitada" integer NOT NULL,
	"cantidad_pickeada" integer DEFAULT 0 NOT NULL,
	"completado" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "full_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nombre_envio" text NOT NULL,
	"archivo_origen" text DEFAULT '' NOT NULL,
	"creado_por" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"articulos_totales" integer DEFAULT 0 NOT NULL,
	"articulos_pickeados" integer DEFAULT 0 NOT NULL,
	"porcentaje" double precision DEFAULT 0 NOT NULL,
	"picker_asignado" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"usuario" text NOT NULL,
	"tipo_mercado" text DEFAULT 'TODOS' NOT NULL,
	"cantidad_pedidos" integer NOT NULL,
	"articulos_totales" integer NOT NULL,
	"resumen_pedidos" text NOT NULL,
	"archivo_pdf_key" text DEFAULT '' NOT NULL,
	"archivo_excel_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer,
	"codigo" text NOT NULL,
	"descripcion" text DEFAULT '' NOT NULL,
	"cantidad" integer NOT NULL,
	CONSTRAINT "chk_order_items_cantidad_pos" CHECK ("order_items"."cantidad" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_locks" (
	"order_id" integer PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"usuario" text NOT NULL,
	"bloqueado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" integer,
	"nota_pedido" text NOT NULL,
	"numero_pedido" text DEFAULT '' NOT NULL,
	"cliente" text NOT NULL,
	"bultos" integer DEFAULT 1 NOT NULL,
	"logistica" text NOT NULL,
	"armador" text NOT NULL,
	"tipo_archivo" text NOT NULL,
	"nombre_archivo" text DEFAULT '' NOT NULL,
	"agregado" boolean DEFAULT false NOT NULL,
	"articulos_descontados" integer DEFAULT 0 NOT NULL,
	"resumen_items" text DEFAULT '' NOT NULL,
	"estado" text DEFAULT 'descontado' NOT NULL,
	"fecha_retiro" text DEFAULT '' NOT NULL,
	"archivo_descuento_key" text DEFAULT '' NOT NULL,
	"cierre_id" integer,
	"cierre_mercado_id" integer,
	"archivo_hash" text DEFAULT '' NOT NULL,
	"numero_guia" text DEFAULT '' NOT NULL,
	"items_sin_coincidencia" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estado_despacho" text DEFAULT 'armado' NOT NULL,
	"despachado_at" timestamp with time zone,
	"despachado_por" text DEFAULT '' NOT NULL,
	"entregado_at" timestamp with time zone,
	"entregado_por" text DEFAULT '' NOT NULL,
	"canal" text DEFAULT 'mayorista' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_orders_bultos_pos" CHECK ("orders"."bultos" >= 1)
);
--> statement-breakpoint
CREATE TABLE "processed_transactions" (
	"tenant_id" uuid NOT NULL,
	"tx_id" text NOT NULL,
	"accion" text NOT NULL,
	"detalle" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_transactions_tenant_id_tx_id_pk" PRIMARY KEY("tenant_id","tx_id")
);
--> statement-breakpoint
CREATE TABLE "shift_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"usuario" text NOT NULL,
	"cantidad_pedidos" integer NOT NULL,
	"articulos_totales" integer NOT NULL,
	"resumen_pedidos" text NOT NULL,
	"archivo_pdf_key" text DEFAULT '' NOT NULL,
	"archivo_excel_key" text DEFAULT '' NOT NULL,
	"archivo_hoja_ruta_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"sha256" text DEFAULT '' NOT NULL,
	"uploaded_by" text DEFAULT 'sistema' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_sessions" ADD CONSTRAINT "api_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_sessions" ADD CONSTRAINT "api_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_inventories" ADD CONSTRAINT "physical_inventories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_inventory_items" ADD CONSTRAINT "physical_inventory_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_inventory_items" ADD CONSTRAINT "physical_inventory_items_inventory_id_physical_inventories_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."physical_inventories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_inventory_items" ADD CONSTRAINT "physical_inventory_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reads" ADD CONSTRAINT "chat_message_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reads" ADD CONSTRAINT "chat_message_reads_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_partial_closures" ADD CONSTRAINT "factory_partial_closures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_partial_closures" ADD CONSTRAINT "factory_partial_closures_plan_id_factory_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."factory_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_plan_items" ADD CONSTRAINT "factory_plan_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_plan_items" ADD CONSTRAINT "factory_plan_items_plan_id_factory_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."factory_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_plan_items" ADD CONSTRAINT "factory_plan_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_plans" ADD CONSTRAINT "factory_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "full_plan_items" ADD CONSTRAINT "full_plan_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "full_plan_items" ADD CONSTRAINT "full_plan_items_plan_id_full_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."full_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "full_plan_items" ADD CONSTRAINT "full_plan_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "full_plans" ADD CONSTRAINT "full_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_closures" ADD CONSTRAINT "market_closures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_locks" ADD CONSTRAINT "order_locks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_locks" ADD CONSTRAINT "order_locks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cierre_id_shift_closures_id_fk" FOREIGN KEY ("cierre_id") REFERENCES "public"."shift_closures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cierre_mercado_id_market_closures_id_fk" FOREIGN KEY ("cierre_mercado_id") REFERENCES "public"."market_closures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_transactions" ADD CONSTRAINT "processed_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_closures" ADD CONSTRAINT "shift_closures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_keys_tenant_active" ON "api_keys" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "idx_api_sessions_tenant_active" ON "api_sessions" USING btree ("tenant_id","last_active");--> statement-breakpoint
CREATE INDEX "idx_api_sessions_user" ON "api_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_login_attempts_tenant_username_lower" ON "login_attempts" USING btree ("tenant_id",lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenants_slug_lower" ON "tenants" USING btree (lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_tenant_username_lower" ON "users" USING btree ("tenant_id",lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_tenant_email_lower" ON "users" USING btree ("tenant_id",lower("email")) WHERE "users"."email" <> '';--> statement-breakpoint
CREATE INDEX "idx_users_tenant_role" ON "users" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE INDEX "idx_users_tenant_active" ON "users" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "idx_webhooks_tenant_active" ON "webhooks" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "idx_admin_notif_tenant_read" ON "admin_notifications" USING btree ("tenant_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_dispatch_items_dispatch" ON "dispatch_items" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "idx_dispatch_items_tenant_code" ON "dispatch_items" USING btree ("tenant_id","product_code");--> statement-breakpoint
CREATE INDEX "idx_dispatches_tenant_fecha" ON "dispatches" USING btree ("tenant_id","fecha");--> statement-breakpoint
CREATE INDEX "idx_phys_inv_tenant_fecha" ON "physical_inventories" USING btree ("tenant_id","fecha");--> statement-breakpoint
CREATE INDEX "idx_phys_inv_items_inv" ON "physical_inventory_items" USING btree ("inventory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_products_tenant_code_lower" ON "products" USING btree ("tenant_id",lower("code"));--> statement-breakpoint
CREATE INDEX "idx_products_tenant_barcode" ON "products" USING btree ("tenant_id","cod_barras");--> statement-breakpoint
CREATE INDEX "idx_products_tenant_ubicacion" ON "products" USING btree ("tenant_id","ubicacion");--> statement-breakpoint
CREATE INDEX "idx_products_tenant_order" ON "products" USING btree ("tenant_id","display_order","id");--> statement-breakpoint
CREATE INDEX "idx_stock_movements_tenant_code" ON "stock_movements" USING btree ("tenant_id","product_code");--> statement-breakpoint
CREATE INDEX "idx_stock_movements_tenant_date" ON "stock_movements" USING btree ("tenant_id","registered_at");--> statement-breakpoint
CREATE INDEX "idx_stock_movements_tenant_type" ON "stock_movements" USING btree ("tenant_id","movement_type");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant_created" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_chat_reads_tenant_usuario" ON "chat_message_reads" USING btree ("tenant_id",lower("usuario"));--> statement-breakpoint
CREATE INDEX "idx_chat_messages_tenant_dest" ON "chat_messages" USING btree ("tenant_id","destinatario","leido");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customers_tenant_nombre_lower" ON "customers" USING btree ("tenant_id",lower("nombre"));--> statement-breakpoint
CREATE INDEX "idx_customers_tenant_codigo" ON "customers" USING btree ("tenant_id","codigo");--> statement-breakpoint
CREATE INDEX "idx_factory_partial_closures_plan" ON "factory_partial_closures" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_factory_plan_items_plan" ON "factory_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_factory_plan_items_plan_codigo" ON "factory_plan_items" USING btree ("plan_id","codigo");--> statement-breakpoint
CREATE INDEX "idx_factory_plans_tenant_estado" ON "factory_plans" USING btree ("tenant_id","estado");--> statement-breakpoint
CREATE INDEX "idx_full_plan_items_plan" ON "full_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_full_plan_items_plan_codigo" ON "full_plan_items" USING btree ("plan_id","codigo");--> statement-breakpoint
CREATE INDEX "idx_full_plans_tenant_estado" ON "full_plans" USING btree ("tenant_id","estado");--> statement-breakpoint
CREATE INDEX "idx_market_closures_tenant_created" ON "market_closures" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_order_items_order" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_items_tenant_codigo" ON "order_items" USING btree ("tenant_id","codigo");--> statement-breakpoint
CREATE INDEX "idx_order_locks_tenant_time" ON "order_locks" USING btree ("tenant_id","bloqueado_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_tenant_nota_lower" ON "orders" USING btree ("tenant_id",lower("nota_pedido"));--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_estado" ON "orders" USING btree ("tenant_id","estado");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_cierre" ON "orders" USING btree ("tenant_id","cierre_id");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_cierre_mercado" ON "orders" USING btree ("tenant_id","cierre_mercado_id");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_despacho" ON "orders" USING btree ("tenant_id","estado_despacho");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_canal" ON "orders" USING btree ("tenant_id","canal");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_hash" ON "orders" USING btree ("tenant_id","archivo_hash");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_created" ON "orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_processed_tx_created" ON "processed_transactions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_shift_closures_tenant_created" ON "shift_closures" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_stored_files_tenant_sha" ON "stored_files" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stored_files_key" ON "stored_files" USING btree ("storage_key");
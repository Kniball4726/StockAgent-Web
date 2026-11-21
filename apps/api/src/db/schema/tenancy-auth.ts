import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { TENANT_PLANS, USER_ROLES } from "@stockagent/shared";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    plan: text("plan", { enum: TENANT_PLANS }).notNull().default("free"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("uq_tenants_slug_lower").on(sql`lower(${t.slug})`)]
);

export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  smtpConfig: jsonb("smtp_config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  telegramConfig: jsonb("telegram_config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  mercadolibreConfig: jsonb("mercadolibre_config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    description: text("description").notNull().default(""),
    events: jsonb("events").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    lastStatus: text("last_status").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_webhooks_tenant_active").on(t.tenantId, t.active)]
);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: USER_ROLES }).notNull(),
    active: boolean("active").notNull().default(true),
    mustChangePassword: boolean("must_change_password")
      .notNull()
      .default(false),
    nombre: text("nombre").notNull().default(""),
    email: text("email").notNull().default(""),
    uiPreferences: jsonb("ui_preferences")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_users_tenant_username_lower").on(
      t.tenantId,
      sql`lower(${t.username})`
    ),
    uniqueIndex("uq_users_tenant_email_lower")
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.email} <> ''`),
    index("idx_users_tenant_role").on(t.tenantId, t.role),
    index("idx_users_tenant_active").on(t.tenantId, t.active),
  ]
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    failedCount: integer("failed_count").notNull().default(0),
    firstFailedAt: timestamp("first_failed_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_login_attempts_tenant_username_lower").on(
      t.tenantId,
      sql`lower(${t.username})`
    ),
  ]
);

export const apiSessions = pgTable(
  "api_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    role: text("role", { enum: USER_ROLES }).notNull(),
    nombre: text("nombre").notNull().default(""),
    email: text("email").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActive: timestamp("last_active", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_api_sessions_tenant_active").on(t.tenantId, t.lastActive),
    index("idx_api_sessions_user").on(t.userId),
  ]
);

export const apiKeys = pgTable(
  "api_keys",
  {
    keyHash: text("key_hash").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clientName: text("client_name").notNull(),
    role: text("role", { enum: USER_ROLES }).notNull().default("operador"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsed: timestamp("last_used", { withTimezone: true }),
  },
  (t) => [index("idx_api_keys_tenant_active").on(t.tenantId, t.active)]
);

import { z } from "zod";
import { TenantPlanSchema, type TenantPlan } from "./domain.js";

export interface TenantPlanQuota {
  plan: TenantPlan;
  maxUsers: number;
  maxProducts: number;
  maxStorageBytes: number;
  allowApiKeys: boolean;
  allowMercadoLibre: boolean;
}

export const TENANT_PLAN_QUOTAS: Record<TenantPlan, TenantPlanQuota> = {
  free: {
    plan: "free",
    maxUsers: 5,
    maxProducts: 500,
    maxStorageBytes: 100 * 1024 * 1024, // 100 MB
    allowApiKeys: false,
    allowMercadoLibre: false,
  },
  pro: {
    plan: "pro",
    maxUsers: 30,
    maxProducts: 15_000,
    maxStorageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    allowApiKeys: true,
    allowMercadoLibre: true,
  },
  enterprise: {
    plan: "enterprise",
    maxUsers: 500,
    maxProducts: 250_000,
    maxStorageBytes: 100 * 1024 * 1024 * 1024, // 100 GB
    allowApiKeys: true,
    allowMercadoLibre: true,
  },
};

export function getTenantPlanQuota(plan: TenantPlan): TenantPlanQuota {
  return TENANT_PLAN_QUOTAS[plan];
}

export const ProvisionTenantRequestSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, {
      message:
        "El slug debe contener entre 3 y 50 caracteres alfanuméricos o guiones.",
    }),
  name: z.string().trim().min(2).max(120),
  plan: TenantPlanSchema.default("pro"),
  adminUsername: z.string().trim().min(3).max(60),
  adminPassword: z.string().min(10).max(128),
  adminNombre: z.string().trim().max(120).default("Administrador"),
  adminEmail: z.string().trim().max(160).default(""),
});
export type ProvisionTenantRequest = z.infer<typeof ProvisionTenantRequestSchema>;

export const UpdateTenantRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    plan: TenantPlanSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined || v.plan !== undefined || v.active !== undefined,
    { message: "Debés indicar al menos un campo para actualizar el tenant." }
  );
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequestSchema>;

export const VerifyBackupRequestSchema = z.object({
  snapshot: z.record(z.string(), z.unknown()),
});
export type VerifyBackupRequest = z.infer<typeof VerifyBackupRequestSchema>;

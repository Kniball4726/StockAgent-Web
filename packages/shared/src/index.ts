import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("stockagent-api"),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export * from "./api.js";
export * from "./domain.js";
export * from "./ingestion.js";
export * from "./saas.js";

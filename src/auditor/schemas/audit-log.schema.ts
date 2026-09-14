import { z } from "zod";

export const auditorAuditLogQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .default(1),

    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20),

    action: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    entityType: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    userId: z
      .string()
      .trim()
      .uuid("Invalid user ID")
      .optional(),
  })
  .strict();

export const auditorAuditLogParamsSchema = z.object({
  auditLogId: z
    .string()
    .trim()
    .uuid("Invalid audit log ID"),
});

export type AuditorAuditLogQuery = z.infer<
  typeof auditorAuditLogQuerySchema
>;

export type AuditorAuditLogParams = z.infer<
  typeof auditorAuditLogParamsSchema
>;
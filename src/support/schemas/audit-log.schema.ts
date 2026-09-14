import { z } from "zod";

export const supportAuditLogQuerySchema = z
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
      .regex(
        /^SUPPORT_[A-Z0-9_]+$/,
        "Action must be a valid SUPPORT audit action",
      )
      .optional(),

    entityType: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),
  })
  .strict();

export const supportAuditLogParamsSchema = z.object({
  auditLogId: z
    .string()
    .trim()
    .uuid("Invalid audit log ID"),
});

export type SupportAuditLogQuery = z.infer<
  typeof supportAuditLogQuerySchema
>;

export type SupportAuditLogParams = z.infer<
  typeof supportAuditLogParamsSchema
>;
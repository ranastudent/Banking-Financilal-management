import { z } from "zod";

export const auditorApprovalRecordParamsSchema = z.object({
  approvalRecordId: z
    .string()
    .trim()
    .uuid("Invalid approval record ID"),
});

export const auditorApprovalRecordQuerySchema = z
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

    decision: z
      .enum([
        "APPROVED",
        "REJECTED",
        "NEEDS_MORE_INFORMATION",
      ])
      .optional(),

    reviewerId: z
      .string()
      .trim()
      .uuid("Invalid reviewer ID")
      .optional(),

    requestId: z
      .string()
      .trim()
      .uuid("Invalid request ID")
      .optional(),
  })
  .strict();

export type AuditorApprovalRecordParams = z.infer<
  typeof auditorApprovalRecordParamsSchema
>;

export type AuditorApprovalRecordQuery = z.infer<
  typeof auditorApprovalRecordQuerySchema
>;
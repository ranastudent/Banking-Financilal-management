import { z } from "zod";

export const auditorFxRequestParamsSchema = z.object({
  requestId: z
    .string()
    .trim()
    .uuid("Invalid FX request ID"),
});

export const auditorFxRequestQuerySchema = z
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

    status: z
      .enum([
        "PENDING",
        "APPROVED",
        "REJECTED",
        "NEEDS_MORE_INFORMATION",
        "EXPIRED",
        "CANCELLED",
      ])
      .optional(),

    userId: z
      .string()
      .trim()
      .uuid("Invalid user ID")
      .optional(),

    accountId: z
      .string()
      .trim()
      .uuid("Invalid account ID")
      .optional(),

    requestedCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z]{3}$/,
        "Currency code must be exactly 3 letters",
      )
      .optional(),
  })
  .strict();

export type AuditorFxRequestParams = z.infer<
  typeof auditorFxRequestParamsSchema
>;

export type AuditorFxRequestQuery = z.infer<
  typeof auditorFxRequestQuerySchema
>;
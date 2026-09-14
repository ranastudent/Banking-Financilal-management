import { z } from "zod";

export const auditorTransactionParamsSchema = z.object({
  transactionId: z
    .string()
    .trim()
    .uuid("Invalid transaction ID"),
});

export const auditorTransactionQuerySchema = z
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
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "REFUNDED",
      ])
      .optional(),

    type: z
      .enum([
        "DEPOSIT",
        "WITHDRAWAL",
        "INTERNAL_TRANSFER",
        "EXTERNAL_DEPOSIT",
        "EXTERNAL_TRANSFER",
        "FX_CONVERSION",
        "REFUND",
      ])
      .optional(),

    provider: z
      .enum([
        "INTERNAL",
        "BKASH",
        "NAGAD",
        "ROCKET",
        "PAYPAL",
        "PAYONEER",
        "WISE",
      ])
      .optional(),

    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z]{3}$/,
        "Currency code must be exactly 3 letters",
      )
      .optional(),

    userId: z
      .string()
      .trim()
      .uuid("Invalid user ID")
      .optional(),

    sourceAccountId: z
      .string()
      .trim()
      .uuid("Invalid source account ID")
      .optional(),

    destinationAccountId: z
      .string()
      .trim()
      .uuid("Invalid destination account ID")
      .optional(),
  })
  .strict();

export type AuditorTransactionParams = z.infer<
  typeof auditorTransactionParamsSchema
>;

export type AuditorTransactionQuery = z.infer<
  typeof auditorTransactionQuerySchema
>;
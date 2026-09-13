import { z } from "zod";

export const customerTransactionParamsSchema = z.object({
  customerId: z
    .string()
    .trim()
    .uuid("Invalid customer ID"),
});

export const customerTransactionQuerySchema = z
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
  })
  .strict();

export type CustomerTransactionParams = z.infer<
  typeof customerTransactionParamsSchema
>;

export type CustomerTransactionQuery = z.infer<
  typeof customerTransactionQuerySchema
>;
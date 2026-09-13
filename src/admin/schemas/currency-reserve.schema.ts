import { z } from "zod";

export const adjustCurrencyReserveSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(
      /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/,
      "Amount must be a valid positive decimal with up to 8 decimal places",
    )
    .refine(
      (value) => Number(value) > 0,
      "Amount must be greater than zero",
    ),

  direction: z.enum(["INCREASE", "DECREASE"]),

  reason: z
    .string()
    .trim()
    .min(3, "Reason must contain at least 3 characters")
    .max(500, "Reason must not exceed 500 characters"),
});

export type AdjustCurrencyReserveInput = z.infer<
  typeof adjustCurrencyReserveSchema
>;
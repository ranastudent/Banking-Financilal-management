import { z } from "zod";

export const depositSchema = z
  .object({
    amount: z
      .string()
      .trim()
      .regex(
        /^\d+(\.\d{1,8})?$/,
        "Amount must be a positive decimal with up to 8 decimal places",
      )
      .refine(
        (value) => Number(value) > 0,
        {
          message: "Amount must be greater than 0",
        },
      ),

    currency: z
      .string()
      .trim()
      .length(3, "Currency must be a 3-letter code")
      .regex(
        /^[A-Za-z]{3}$/,
        "Currency must contain exactly 3 letters",
      )
      .transform((value) => value.toUpperCase()),
  })
  .strict();

export type DepositInput = z.infer<typeof depositSchema>;
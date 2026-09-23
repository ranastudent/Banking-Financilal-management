import { z } from "zod";

export const transferSchema = z
  .object({
    senderAccount: z
      .string()
      .trim()
      .min(1, "Sender account is required"),

    receiverAccount: z
      .string()
      .trim()
      .min(1, "Receiver account is required"),

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
      .length(
        3,
        "Currency must be a 3-letter code",
      )
      .regex(
        /^[A-Za-z]{3}$/,
        "Currency must contain exactly 3 letters",
      )
      .transform((value) =>
        value.toUpperCase(),
      ),
  })
  .strict();

export type TransferInput =
  z.infer<typeof transferSchema>;
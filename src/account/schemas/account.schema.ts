import { z } from "zod";

export const createAccountSchema = z
  .object({
    accountType: z.enum([
      "SAVINGS",
      "CURRENT",
      "FOREIGN_CURRENCY",
    ]),

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

export type CreateAccountInput = z.infer<
  typeof createAccountSchema
>;

export const updateAccountStatusSchema = z
  .object({
    status: z.enum([
      "ACTIVE",
      "FROZEN",
      "CLOSED",
    ]),
  })
  .strict();

export type UpdateAccountStatusInput = z.infer<
  typeof updateAccountStatusSchema
>;
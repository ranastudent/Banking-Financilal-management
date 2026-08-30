import { z } from "zod";

/**
 * Common field schemas
 */

export const emailSchema = z
  .string()
  .trim()
  .email();

export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Amount must have at most 2 decimal places")
  .refine((value) => Number(value) > 0, {
    message: "Amount must be greater than zero",
  });

export const currencySchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase code");

export const accountNumberSchema = z
  .string()
  .trim()
  .min(5)
  .max(34)
  .regex(/^[A-Za-z0-9]+$/, "Invalid account number");

/**
 * Basic validation test schema
 */

export const testValidationSchema = z
  .object({
    email: emailSchema,
    amount: amountSchema,
    currency: currencySchema,
    accountNumber: accountNumberSchema,
  })
  .strict();

/**
 * Beneficiary validation
 */

export const beneficiarySchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    accountNumber: accountNumberSchema,
    currency: currencySchema,
  })
  .strict();

/**
 * Pagination validation
 */

export const paginationSchema = z
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
  })
  .strict();
import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .email();

export const currencyCodeSchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Z]{3}$/);

export const accountNumberSchema = z
  .string()
  .trim()
  .min(5)
  .max(34)
  .regex(/^[A-Za-z0-9]+$/);

export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine(
    (value) => Number(value) > 0,
    "Amount must be greater than zero",
  );

export const paginationSchema = z.object({
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
});
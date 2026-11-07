import { z } from "zod";

export const currencyCodeParamsSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z]{3}$/, "Currency code must be a 3-letter code"),
  })
  .strict();

export const changeCurrencyStatusSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

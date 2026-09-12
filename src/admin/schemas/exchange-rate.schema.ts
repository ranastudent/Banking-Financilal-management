import { z } from "zod";

export const createExchangeRateSchema = z
  .object({
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Base currency must be a valid 3-letter code"),

    quoteCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Quote currency must be a valid 3-letter code"),

    rate: z.coerce.number().positive(),

    buyRate: z.coerce.number().positive().optional(),

    sellRate: z.coerce.number().positive().optional(),

    spread: z.coerce.number().nonnegative().optional(),

    source: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    version: z.coerce.number().int().min(1),

    effectiveFrom: z.coerce.date(),

    effectiveTo: z.coerce.date().nullable().optional(),

    status: z
      .enum(["ACTIVE", "INACTIVE", "EXPIRED"])
      .default("ACTIVE"),
  })
  .superRefine((data, ctx) => {
    if (data.baseCurrency === data.quoteCurrency) {
      ctx.addIssue({
        code: "custom",
        path: ["quoteCurrency"],
        message: "Base and quote currencies must be different",
      });
    }

    if (
      data.effectiveTo !== null &&
      data.effectiveTo !== undefined &&
      data.effectiveTo <= data.effectiveFrom
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "effectiveTo must be later than effectiveFrom",
      });
    }

    if (
      data.buyRate !== undefined &&
      data.buyRate > data.rate
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["buyRate"],
        message: "buyRate cannot be greater than rate",
      });
    }

    if (
      data.sellRate !== undefined &&
      data.sellRate < data.rate
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sellRate"],
        message: "sellRate cannot be lower than rate",
      });
    }
  });

export type CreateExchangeRateInput = z.infer<
  typeof createExchangeRateSchema
>;
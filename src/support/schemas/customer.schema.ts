import { z } from "zod";

export const customerLookupQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1, "Search term is required")
      .max(100, "Search term must not exceed 100 characters"),

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

export type CustomerLookupQuery = z.infer<
  typeof customerLookupQuerySchema
>;
import { z } from "zod";

export const auditorAccountActivityParamsSchema = z.object({
  accountId: z
    .string()
    .trim()
    .uuid("Invalid account ID"),
});

export const auditorAccountActivityQuerySchema = z
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

export type AuditorAccountActivityParams =
  z.infer<typeof auditorAccountActivityParamsSchema>;

export type AuditorAccountActivityQuery =
  z.infer<typeof auditorAccountActivityQuerySchema>;
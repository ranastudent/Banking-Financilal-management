import { z } from "zod";

export const customerAccountParamsSchema = z.object({
  accountId: z
    .string()
    .trim()
    .uuid("Invalid account ID"),
});

export type CustomerAccountParams = z.infer<
  typeof customerAccountParamsSchema
>;
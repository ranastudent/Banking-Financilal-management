import { z } from "zod";

export const updateUserStatusSchema = z
  .object({
    status: z.enum(["ACTIVE", "BLOCKED", "SUSPENDED"]),
  })
  .strict();

export type UpdateUserStatusInput = z.infer<
  typeof updateUserStatusSchema
>;
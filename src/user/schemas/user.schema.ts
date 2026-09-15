import { z } from "zod";

export const updateMyProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must not exceed 100 characters")
      .optional(),

    phone: z
      .string()
      .trim()
      .min(7, "Invalid phone number")
      .max(20, "Invalid phone number")
      .nullable()
      .optional(),
  })
  .strict();

export type UpdateMyProfileInput = z.infer<
  typeof updateMyProfileSchema
>;
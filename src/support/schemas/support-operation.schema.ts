import { z } from "zod";

export const supportOperationParamsSchema = z.object({
  customerId: z
    .string()
    .trim()
    .uuid("Invalid customer ID"),
});

export const supportOperationBodySchema = z.object({
  operationType: z.enum([
    "ACCOUNT_INQUIRY",
    "TRANSACTION_INQUIRY",
    "BENEFICIARY_ASSISTANCE",
    "GENERAL_SUPPORT",
  ]),

  description: z
    .string()
    .trim()
    .min(3, "Description must be at least 3 characters")
    .max(
      1000,
      "Description must not exceed 1000 characters",
    ),
});

export type SupportOperationParams = z.infer<
  typeof supportOperationParamsSchema
>;

export type SupportOperationBody = z.infer<
  typeof supportOperationBodySchema
>;
import { z } from "zod";

const paymentProviderSchema = z.enum([
  "INTERNAL",
  "BKASH",
  "NAGAD",
  "ROCKET",
  "PAYPAL",
  "PAYONEER",
  "WISE",
]);

const currencyCodeSchema = z
  .string()
  .trim()
  .length(3, "Currency code must contain exactly 3 letters")
  .regex(/^[A-Za-z]{3}$/, "Currency code must contain only letters")
  .transform((value) => value.toUpperCase());

export const beneficiaryIdParamsSchema = z
  .object({
    beneficiaryId: z.string().uuid("Invalid beneficiary ID"),
  })
  .strict();

export const createBeneficiarySchema = z
  .object({
    beneficiaryType: z.enum(["INTERNAL", "EXTERNAL"]),
    displayName: z
      .string()
      .trim()
      .min(1, "Display name is required")
      .max(100, "Display name must not exceed 100 characters"),
    accountReference: z
      .string()
      .trim()
      .min(1, "Account reference is required")
      .max(128, "Account reference must not exceed 128 characters"),
    provider: paymentProviderSchema.nullable().optional(),
    currencyCode: currencyCodeSchema,
  })
  .strict();

export const updateBeneficiarySchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "Display name cannot be empty")
      .max(100, "Display name must not exceed 100 characters")
      .optional(),
    accountReference: z
      .string()
      .trim()
      .min(1, "Account reference cannot be empty")
      .max(128, "Account reference must not exceed 128 characters")
      .optional(),
    provider: paymentProviderSchema.nullable().optional(),
    currencyCode: currencyCodeSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one supported field must be provided",
  });

export const listBeneficiariesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type BeneficiaryIdParams = z.infer<
  typeof beneficiaryIdParamsSchema
>;
export type CreateBeneficiaryInput = z.infer<
  typeof createBeneficiarySchema
>;
export type UpdateBeneficiaryInput = z.infer<
  typeof updateBeneficiarySchema
>;
export type ListBeneficiariesQuery = z.infer<
  typeof listBeneficiariesQuerySchema
>;

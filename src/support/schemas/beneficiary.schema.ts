import { z } from "zod";

export const beneficiaryAssistanceParamsSchema = z.object({
  customerId: z
    .string()
    .trim()
    .uuid("Invalid customer ID"),

  beneficiaryId: z
    .string()
    .trim()
    .uuid("Invalid beneficiary ID"),
});

export type BeneficiaryAssistanceParams = z.infer<
  typeof beneficiaryAssistanceParamsSchema
>;
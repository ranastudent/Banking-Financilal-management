import { z } from "zod";

export const approvalDecisionSchema = z.object({
  decision: z.enum([
    "APPROVED",
    "REJECTED",
    "NEEDS_MORE_INFORMATION",
  ]),

  comment: z
    .string()
    .trim()
    .min(3, "Comment must contain at least 3 characters")
    .max(1000, "Comment must not exceed 1000 characters"),
});

export type ApprovalDecisionInput = z.infer<
  typeof approvalDecisionSchema
>;
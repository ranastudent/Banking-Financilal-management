import { z } from "zod";

export const riskReviewDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(1000).optional(),
}).strict();

export type RiskReviewDecisionInput = z.infer<typeof riskReviewDecisionSchema>;

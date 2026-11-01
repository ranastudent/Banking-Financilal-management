import type { Request, Response } from "express";
import { listCustomerDecisionExplanations } from "../services/decision-explanation.service";
export const myDecisionExplanations = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const data = await listCustomerDecisionExplanations(req.user!.id, page, limit);
  res.json({ success: true, data, pagination: { page, limit }, requestId: req.requestId });
};

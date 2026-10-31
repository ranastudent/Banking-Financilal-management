import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { riskReviewDecisionSchema } from "../schemas/risk-review.schema";
import { decideRiskReview, getRiskReviewById, listPendingRiskReviews } from "../services/risk-review.service";

const parsePagination = (req: Request) => {
  const page = typeof req.query.page === "string" ? Number(req.query.page) : 1;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("Invalid pagination parameters", 400, ErrorCode.BAD_REQUEST);
  }
  return { page, limit };
};

export const listRiskReviews = async (req: Request, res: Response): Promise<void> => {
  const { page, limit } = parsePagination(req);
  res.status(200).json({ success: true, data: await listPendingRiskReviews(page, limit), requestId: req.requestId });
};

export const getRiskReview = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.riskAnalysisId;
  if (typeof id !== "string" || id.length === 0) throw new AppError("Risk analysis ID is required", 400, ErrorCode.BAD_REQUEST);
  res.status(200).json({ success: true, data: await getRiskReviewById(id), requestId: req.requestId });
};

export const postRiskReviewDecision = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError("Authentication required", 401, ErrorCode.UNAUTHORIZED);
  const id = req.params.riskAnalysisId;
  if (typeof id !== "string" || id.length === 0) throw new AppError("Risk analysis ID is required", 400, ErrorCode.BAD_REQUEST);
  const parsed = riskReviewDecisionSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid review decision", 400, ErrorCode.VALIDATION_ERROR);
  const data = await decideRiskReview(id, parsed.data, req.user.id, req.requestId, req.ip, req.get("user-agent"));
  res.status(200).json({ success: true, data, requestId: req.requestId });
};

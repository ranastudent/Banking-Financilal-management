import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { approvalDecisionSchema } from "../schemas/approval.schema";
import {
  decideAdminApprovalRequest,
  getAdminApprovalRequestById,
  getAdminApprovalRequests,
} from "../services/approval.service";

export const getApprovalRequests = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;

  const page =
    typeof rawPage === "string" && rawPage.trim() !== ""
      ? Number(rawPage)
      : 1;

  const limit =
    typeof rawLimit === "string" && rawLimit.trim() !== ""
      ? Number(rawLimit)
      : 20;

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError(
      "Page must be a positive integer",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError(
      "Limit must be between 1 and 100",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const result = await getAdminApprovalRequests(page, limit);

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getApprovalRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const requestId = req.params.requestId;

  if (
    typeof requestId !== "string" ||
    requestId.trim() === ""
  ) {
    throw new AppError(
      "Request ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const requestData =
    await getAdminApprovalRequestById(requestId);

  res.status(200).json({
    success: true,
    data: {
      request: requestData,
    },
    requestId: req.requestId,
  });
};

export const decideApprovalRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const requestId = req.params.requestId;

  if (
    typeof requestId !== "string" ||
    requestId.trim() === ""
  ) {
    throw new AppError(
      "Request ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const parsed = approvalDecisionSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ??
        "Invalid approval decision data",
      400,
      ErrorCode.VALIDATION_ERROR,
    );
  }

  const updatedRequest =
    await decideAdminApprovalRequest(
      requestId,
      parsed.data,
      req.user.id,
      req.ip,
      req.get("user-agent"),
    );

  res.status(200).json({
    success: true,
    data: {
      request: updatedRequest,
    },
    requestId: req.requestId,
  });
};
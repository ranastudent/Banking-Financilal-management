import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

import type {
  AuditorApprovalRecordParams,
  AuditorApprovalRecordQuery,
} from "../schemas/approval-record.schema";

import {
  getAuditorApprovalRecordById,
  getAuditorApprovalRecords,
} from "../services/approval-record.service";

export const getAuditorApprovalRecordsController = async (
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

  const query =
    req.validatedQuery as AuditorApprovalRecordQuery;

  const result =
    await getAuditorApprovalRecords(
      req.user,
      query.page,
      query.limit,
      {
        ...(query.decision !== undefined && {
          decision: query.decision,
        }),

        ...(query.reviewerId !== undefined && {
          reviewerId: query.reviewerId,
        }),

        ...(query.requestId !== undefined && {
          requestId: query.requestId,
        }),
      },
    );

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getAuditorApprovalRecordController = async (
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

  const params =
    req.validatedParams as AuditorApprovalRecordParams;

  const approvalRecord =
    await getAuditorApprovalRecordById(
      req.user,
      params.approvalRecordId,
    );

  res.status(200).json({
    success: true,
    data: {
      approvalRecord,
    },
    requestId: req.requestId,
  });
};
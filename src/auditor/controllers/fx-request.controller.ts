import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

import type {
  AuditorFxRequestParams,
  AuditorFxRequestQuery,
} from "../schemas/fx-request.schema";

import {
  getAuditorFxRequestById,
  getAuditorFxRequests,
} from "../services/fx-request.service";

export const getAuditorFxRequestsController = async (
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
    req.validatedQuery as AuditorFxRequestQuery;

  const result = await getAuditorFxRequests(
    req.user,
    query.page,
    query.limit,
    {
      ...(query.status !== undefined && {
        status: query.status,
      }),

      ...(query.userId !== undefined && {
        userId: query.userId,
      }),

      ...(query.accountId !== undefined && {
        accountId: query.accountId,
      }),

      ...(query.requestedCurrency !== undefined && {
        requestedCurrency:
          query.requestedCurrency,
      }),
    },
  );

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getAuditorFxRequestController = async (
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
    req.validatedParams as AuditorFxRequestParams;

  const fxRequest =
    await getAuditorFxRequestById(
      req.user,
      params.requestId,
    );

  res.status(200).json({
    success: true,
    data: {
      fxRequest,
    },
    requestId: req.requestId,
  });
};
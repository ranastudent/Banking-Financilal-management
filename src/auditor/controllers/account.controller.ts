import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type {
  AuditorAccountActivityParams,
  AuditorAccountActivityQuery,
} from "../schemas/account.schema";

import { getAuditorAccountActivity } from "../services/account.service";

export const getAuditorAccountActivityController = async (
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
    req.validatedParams as AuditorAccountActivityParams;

  const query =
    req.validatedQuery as AuditorAccountActivityQuery;

  const result =
    await getAuditorAccountActivity(
      req.user,
      params.accountId,
      query.page,
      query.limit,
    );

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};
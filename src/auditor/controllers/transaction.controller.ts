import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type {
  AuditorTransactionParams,
  AuditorTransactionQuery,
} from "../schemas/transaction.schema";
import {
  getAuditorTransactionById,
  getAuditorTransactions,
} from "../services/transaction.service";

export const getAuditorTransactionsController = async (
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
    req.validatedQuery as AuditorTransactionQuery;

  const filters = {
    ...(query.status !== undefined && {
      status: query.status,
    }),

    ...(query.type !== undefined && {
      type: query.type,
    }),

    ...(query.provider !== undefined && {
      provider: query.provider,
    }),

    ...(query.currencyCode !== undefined && {
      currencyCode: query.currencyCode,
    }),

    ...(query.userId !== undefined && {
      userId: query.userId,
    }),

    ...(query.sourceAccountId !== undefined && {
      sourceAccountId: query.sourceAccountId,
    }),

    ...(query.destinationAccountId !== undefined && {
      destinationAccountId:
        query.destinationAccountId,
    }),
  };

  const result = await getAuditorTransactions(
    req.user,
    query.page,
    query.limit,
    filters,
  );

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getAuditorTransactionController = async (
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
    req.validatedParams as AuditorTransactionParams;

  const transaction =
    await getAuditorTransactionById(
      req.user,
      params.transactionId,
    );

  res.status(200).json({
    success: true,
    data: {
      transaction,
    },
    requestId: req.requestId,
  });
};
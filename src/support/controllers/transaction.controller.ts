import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type {
  CustomerTransactionParams,
  CustomerTransactionQuery,
} from "../schemas/transaction.schema";
import {
  getSupportCustomerTransactions,
} from "../services/transaction.service";

export const getCustomerTransactions = async (
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
    req.validatedParams as CustomerTransactionParams;

  const query =
    req.validatedQuery as CustomerTransactionQuery;

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
  };

  const result =
    await getSupportCustomerTransactions(
      req.user,
      params.customerId,
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
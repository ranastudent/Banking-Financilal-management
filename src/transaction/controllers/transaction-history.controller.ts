import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { getTransactionHistory } from "../history/transaction-history.service";
import {
  getTransactionPaginationMode,
  transactionHistoryQuerySchema,
  type TransactionHistoryQuery,
} from "../validation/transaction-history-query";

export const getTransactionHistoryController = async (
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

  const paginationMode = getTransactionPaginationMode(req.query);

  const query =
    (req.validatedQuery as TransactionHistoryQuery | undefined) ??
    transactionHistoryQuerySchema.parse(req.query);

  const result = await getTransactionHistory(
    req.user,
    query,
    paginationMode,
  );

  res.status(200).json({
    success: true,
    data: {
      transactions: result.transactions,
      pagination: result.pagination,
    },
    requestId: req.requestId,
  });
};
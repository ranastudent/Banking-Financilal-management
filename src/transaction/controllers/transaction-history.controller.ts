import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

import {
  getTransactionHistory,
} from "../history/transaction-history.service";

import {
  transactionHistoryQuerySchema,
  type TransactionHistoryQuery,
} from "../validation/transaction-history-query";

/**
 * Retrieves paginated transaction history for the authenticated user.
 *
 * The route should apply:
 *
 * authenticate
 * authorize
 * validate({ query: transactionHistoryQuerySchema })
 *
 * before invoking this controller.
 */
export const getTransactionHistoryController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  // ----------------------------------------------------------
  // 1. Verify authenticated user
  // ----------------------------------------------------------

  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  // ----------------------------------------------------------
  // 2. Retrieve validated query parameters
  // ----------------------------------------------------------

  const query = (
    req.validatedQuery as TransactionHistoryQuery | undefined
  ) ?? transactionHistoryQuerySchema.parse(req.query);

  // ----------------------------------------------------------
  // 3. Execute transaction history service
  // ----------------------------------------------------------

  const result = await getTransactionHistory(
    req.user,
    query,
  );

  // ----------------------------------------------------------
  // 4. Return successful response
  // ----------------------------------------------------------

  res.status(200).json({
    success: true,
    data: {
      transactions: result.transactions,
      pagination: result.pagination,
    },
    requestId: req.requestId,
  });
};
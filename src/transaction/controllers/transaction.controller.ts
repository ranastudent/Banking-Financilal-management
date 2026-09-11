import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { authorizeTransactionView } from "../services/transaction.service";

export const getTransaction = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const transactionId = req.params.transactionId;

  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (
    typeof transactionId !== "string" ||
    transactionId.trim() === ""
  ) {
    throw new AppError(
      "Transaction ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const transaction = await authorizeTransactionView(
    transactionId,
    req.user.id,
    req.user.role,
  );

  res.status(200).json({
    success: true,
    data: {
      transaction,
    },
    requestId: req.requestId,
  });
};
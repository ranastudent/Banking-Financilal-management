import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import {
  getAdminTransactionById,
  getAdminTransactions,
} from "../services/transaction.service";

export const getTransactions = async (
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

  const result = await getAdminTransactions(page, limit);

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getTransaction = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const transactionId = req.params.transactionId;

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

  const transaction =
    await getAdminTransactionById(transactionId);

  res.status(200).json({
    success: true,
    data: {
      transaction,
    },
    requestId: req.requestId,
  });
};
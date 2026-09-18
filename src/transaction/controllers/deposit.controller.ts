import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { getDepositAuthorizedAccount } from "../policies/deposit.policy";
import { prepareDeposit } from "../services/deposit.service";
import {
  completeIdempotencyRecord, clearIdempotencyRecord,
} from "../../middleware/idempotency.middleware";

export const authorizeDeposit = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const accountId = req.params.accountId;

  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (
    typeof accountId !== "string" ||
    accountId.trim() === ""
  ) {
    throw new AppError(
      "Account ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const account = await getDepositAuthorizedAccount(
    accountId,
    req.user.id,
    req.user.role,
  );

  res.status(200).json({
    success: true,
    data: {
      message: "Deposit authorization successful",
      accountId: account.id,
      accountNumber: account.accountNumber,
      userId: req.user.id,
      userRole: req.user.role,
    },
    requestId: req.requestId,
  });
};

export const processDeposit = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const accountId = req.params.accountId;

  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (
    typeof accountId !== "string" ||
    accountId.trim() === ""
  ) {
    throw new AppError(
      "Account ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  let result;

  try {
    result = await prepareDeposit(
      req.user,
      accountId,
      req.body,
    );
  } catch (error) {
    await clearIdempotencyRecord(res);
    throw error;
  }

  const responseData = {
    message: "Deposit transaction created successfully",
    accountId: result.account.id,
    accountNumber: result.account.accountNumber,
    currency: result.currency.code,
    amount: result.amount.toString(),

    balance: result.balance,

    ledgerEntry: result.ledgerEntry,

    transaction: result.transaction,

    userId: req.user.id,
    userRole: req.user.role,
  };

  await completeIdempotencyRecord(
    res,
    200,
    responseData,
  );

  res.status(200).json({
    success: true,
    data: responseData,
    requestId: req.requestId,
  });
};
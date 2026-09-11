import type { Request, Response } from "express";

import { getDepositAuthorizedAccount } from "../policies/deposit.policy";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

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

  if (typeof accountId !== "string" || accountId.trim() === "") {
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

  /*
   * Authorization boundary only.
   *
   * No balance update.
   * No transaction creation.
   * No ledger entry.
   *
   * Actual deposit processing will be implemented
   * in the transaction/business-logic phase.
   */
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
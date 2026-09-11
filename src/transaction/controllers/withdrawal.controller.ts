import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { authorizeWithdrawal } from "../services/withdrawal.service";

export const withdrawalAuthorizationController = async (
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

  const account = await authorizeWithdrawal(
    accountId,
    req.user.id,
    req.user.role,
  );

  res.status(200).json({
    success: true,
    data: {
      message: "Withdrawal authorization successful",
      accountId: account.id,
      accountNumber: account.accountNumber,
      userId: req.user.id,
      userRole: req.user.role,
    },
    requestId: req.requestId,
  });
};
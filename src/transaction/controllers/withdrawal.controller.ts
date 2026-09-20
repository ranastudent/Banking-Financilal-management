import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import {
  clearIdempotencyRecord,
  completeIdempotencyRecord,
} from "../../middleware/idempotency.middleware";
import { prepareWithdrawal } from "../services/withdrawal.service";

export const processWithdrawal = async (
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
    result = await prepareWithdrawal(
      req.user,
      accountId,
      req.body,
    );
  } catch (error) {
    /*
     * The financial operation failed.
     * Release the idempotency reservation so a
     * failed request can be retried.
     */
    await clearIdempotencyRecord(res);
    throw error;
  }

  const responseData = {
    message:
      "Withdrawal transaction created successfully",

    accountId:
      result.account.id,

    accountNumber:
      result.account.accountNumber,

    currency:
      result.currency.code,

    amount:
      result.amount.toString(),

    balance: {
      balanceBefore:
        result.balanceBefore,

      balanceAfter:
        result.balanceAfter,

      lockedBalance:
        result.lockedBalance,
    },

    transaction:
      result.transaction,

    ledgerEntry:
      result.ledgerEntry,

    auditLog:
      result.auditLog,

    userId:
      req.user.id,

    userRole:
      req.user.role,
  };

  /*
   * Save the exact successful response.
   */
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
import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { authorizeTransfer } from "../services/transfer.service";

export const transferAuthorizationController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const sourceAccountId = req.params.sourceAccountId;
  const destinationAccountId = req.params.destinationAccountId;

  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (
    typeof sourceAccountId !== "string" ||
    sourceAccountId.trim() === ""
  ) {
    throw new AppError(
      "Source account ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  if (
    typeof destinationAccountId !== "string" ||
    destinationAccountId.trim() === ""
  ) {
    throw new AppError(
      "Destination account ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const { sourceAccount, destinationAccount } =
    await authorizeTransfer(
      sourceAccountId,
      destinationAccountId,
      req.user.id,
      req.user.role,
    );

  /*
   * Authorization boundary only.
   *
   * No balance changes.
   * No transaction creation.
   * No ledger entries.
   */
  res.status(200).json({
    success: true,
    data: {
      message: "Transfer authorization successful",
      sourceAccountId: sourceAccount.id,
      destinationAccountId: destinationAccount.id,
      userId: req.user.id,
      userRole: req.user.role,
    },
    requestId: req.requestId,
  });
};
import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

import {
  authorizeTransfer,
  prepareTransfer,
} from "../services/transfer.service";

import {
  clearIdempotencyRecord,
} from "../../middleware/idempotency.middleware";
import { recordTransferResult } from "../../observability/metrics";
import { logger } from "../../observability/logger";

export const transferAuthorizationController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const sourceAccountId = req.params.sourceAccountId;
  const destinationAccountId =
    req.params.destinationAccountId;

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

export const processTransfer = async (
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

  /*
   * This ID must be assigned by your idempotency
   * middleware before the controller executes.
   *
   * Confirm the property name against that middleware.
   */

  const idempotencyRecordId: unknown =
    res.locals.idempotencyRecordId;

  if (
    typeof idempotencyRecordId !== "string" ||
    idempotencyRecordId.trim() === ""
  ) {
    throw new AppError(
      "Idempotency reservation is missing",
      500,
      ErrorCode.INTERNAL_SERVER_ERROR,
    );
  }

  let result;

  try {
    /*
     * The transfer and idempotency completion now occur
     * inside the same Prisma transaction.
     */

    result = await prepareTransfer(
      req.user,
      req.body,
      idempotencyRecordId,
      {
        requestId: req.requestId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      },
    );
  } catch (error) {
    recordTransferResult(false);
    logger.warn("transfer.failed", {
      requestId: req.requestId,
      userId: req.user.id,
      endpoint: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    /*
     * Preserve the existing cleanup behavior.
     *
     * Note: for an ambiguous database commit outcome,
     * production hardening should avoid blindly deleting
     * the reservation. This catch preserves your current
     * behavior for the minimal fix.
     */

    await clearIdempotencyRecord(res);
    throw error;
  }

  const isHeld = "held" in result && result.held;
  if (isHeld) {
    logger.info("transfer.held_for_risk_review", {
      requestId: req.requestId,
      userId: req.user.id,
      transactionId: result.transaction.id,
    });
  } else {
    recordTransferResult(true);
    logger.info("transfer.succeeded", {
      requestId: req.requestId,
      userId: req.user.id,
      transactionId: result.transaction.id,
    });
  }

  const responseData = {
    message: "Fund transfer completed successfully",
    transaction: result.transaction,
  };

  /*
   * Do not call completeIdempotencyRecord() here.
   *
   * The response was already persisted by the service
   * inside the financial Prisma transaction.
   */

  res.status(isHeld ? 202 : 200).json({
    success: true,
    data: "held" in result && result.held
      ? { message: "Transfer is on hold pending risk review. No money has been moved.", transaction: result.transaction, risk: result.risk }
      : responseData,
    requestId: req.requestId,
  });
};
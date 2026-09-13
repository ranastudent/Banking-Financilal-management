import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type {
  SupportOperationBody,
  SupportOperationParams,
} from "../schemas/support-operation.schema";
import {
  recordCustomerSupportOperation,
} from "../services/support-operation.service";

export const recordSupportOperation = async (
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

  const params =
    req.validatedParams as SupportOperationParams;

  const body =
    req.body as SupportOperationBody;

  const supportOperation =
    await recordCustomerSupportOperation(
      req.user,
      params.customerId,
      body.operationType,
      body.description,
      req.ip ?? null,
      req.get("user-agent") ?? null,
    );

  res.status(201).json({
    success: true,
    data: supportOperation,
    requestId: req.requestId,
  });
};
import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { createCustomerAccount } from "../services/account.service";

export const createAccount = async (
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

  const account = await createCustomerAccount(
    req.user,
    req.body,
  );

  res.status(201).json({
    success: true,
    data: {
      account,
    },
    requestId: req.requestId,
  });
};
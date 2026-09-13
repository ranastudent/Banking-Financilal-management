import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { CustomerAccountParams } from "../schemas/account.schema";
import { getSupportCustomerAccount } from "../services/account.service";

export const getCustomerAccount = async (
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
    req.validatedParams as CustomerAccountParams;

  const account = await getSupportCustomerAccount(
    req.user,
    params.accountId,
  );

  res.status(200).json({
    success: true,
    data: {
      account,
    },
    requestId: req.requestId,
  });
};
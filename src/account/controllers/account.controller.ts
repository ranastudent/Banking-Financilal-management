import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { createCustomerAccount, getCustomerAccounts, getCustomerAccountById } from "../services/account.service";

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

export const getAccounts = async (
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

  const accounts = await getCustomerAccounts(
    req.user.id,
  );

  res.status(200).json({
    success: true,
    data: {
      accounts,
    },
    requestId: req.requestId,
  });
};

export const getAccount = async (
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

  const { accountId } = req.params;

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

  const account = await getCustomerAccountById(
    accountId,
    req.user.id,
  );

  res.status(200).json({
    success: true,
    data: {
      account,
    },
    requestId: req.requestId,
  });
};
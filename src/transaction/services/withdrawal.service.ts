import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const prepareWithdrawal = async (
  user: AuthUser,
  accountId: string,
) => {
  if (!UUID_REGEX.test(accountId)) {
    throw new AppError(
      "Invalid account ID",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const account = await tx.account.findUnique({
        where: {
          id: accountId,
        },
        select: {
          id: true,
          userId: true,
          accountNumber: true,
          accountType: true,
          status: true,
        },
      });

      if (!account) {
        throw new AppError(
          "Account not found",
          404,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      if (
        user.role === "CUSTOMER" &&
        account.userId !== user.id
      ) {
        throw new AppError(
          "You do not have permission to withdraw from this account",
          403,
          ErrorCode.FORBIDDEN,
        );
      }

      if (
        user.role !== "CUSTOMER" &&
        user.role !== "ADMIN"
      ) {
        throw new AppError(
          "You do not have permission to perform a withdrawal",
          403,
          ErrorCode.FORBIDDEN,
        );
      }

      return account;
    },
  );
};

export const authorizeWithdrawal = async (
  accountId: string,
  userId: string,
  userRole: string,
) => {
  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      if (!UUID_REGEX.test(accountId)) {
        throw new AppError(
          "Invalid account ID",
          400,
          ErrorCode.BAD_REQUEST,
        );
      }

      const account = await tx.account.findUnique({
        where: {
          id: accountId,
        },
      });

      if (!account) {
        throw new AppError(
          "Account not found",
          404,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      if (
        userRole === "CUSTOMER" &&
        account.userId !== userId
      ) {
        throw new AppError(
          "You do not have permission to withdraw from this account",
          403,
          ErrorCode.FORBIDDEN,
        );
      }

      if (
        userRole !== "CUSTOMER" &&
        userRole !== "ADMIN"
      ) {
        throw new AppError(
          "You do not have permission to perform a withdrawal",
          403,
          ErrorCode.FORBIDDEN,
        );
      }

      return account;
    },
  );
};
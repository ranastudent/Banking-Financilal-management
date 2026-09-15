import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";

import {
  assertAuditorPermission,
  AuditorPermission,
} from "../policies/auditor.policy";

const SAFE_ACCOUNT_ACTIVITY_SELECT = {
  id: true,
  userId: true,
  accountNumber: true,
  accountType: true,
  status: true,
  createdAt: true,
  updatedAt: true,

  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
    },
  },

  balances: {
    select: {
      id: true,
      currencyCode: true,
      availableBalance: true,
      lockedBalance: true,
      updatedAt: true,

      currency: {
        select: {
          code: true,
          name: true,
          symbol: true,
          decimalPlaces: true,
          isActive: true,
        },
      },
    },

    orderBy: {
      currencyCode: "asc" as const,
    },
  },
} as const;

const SAFE_ACCOUNT_ACTIVITY_TRANSACTION_SELECT = {
  id: true,
  reference: true,
  type: true,
  status: true,
  amount: true,
  currencyCode: true,
  sourceAccountId: true,
  destinationAccountId: true,
  provider: true,
  providerTransactionId: true,
  failureCode: true,
  failureReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const getAuditorAccountActivity = async (
  user: AuthUser,
  accountId: string,
  page: number,
  limit: number,
) => {
  assertAuditorPermission(
    user,
    AuditorPermission.ACCOUNT_ACTIVITY_VIEW,
  );

  const account = await prisma.account.findUnique({
    where: {
      id: accountId,
    },
    select: SAFE_ACCOUNT_ACTIVITY_SELECT,
  });

  if (!account) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  const skip = (page - 1) * limit;

  const transactionWhere = {
    OR: [
      {
        sourceAccountId: accountId,
      },
      {
        destinationAccountId: accountId,
      },
    ],
  };

  const [transactions, total] =
    await prisma.$transaction([
      prisma.transaction.findMany({
        where: transactionWhere,
        skip,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
        select:
          SAFE_ACCOUNT_ACTIVITY_TRANSACTION_SELECT,
      }),

      prisma.transaction.count({
        where: transactionWhere,
      }),
    ]);

  return {
    account,
    activity: {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  };
};
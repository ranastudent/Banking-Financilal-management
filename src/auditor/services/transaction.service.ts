import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import {
  assertAuditorPermission,
  AuditorPermission,
} from "../policies/auditor.policy";

const SAFE_AUDITOR_TRANSACTION_SELECT = {
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

type TransactionFilters = {
  status?: string;
  type?: string;
  provider?: string;
  currencyCode?: string;
  userId?: string;
  sourceAccountId?: string;
  destinationAccountId?: string;
};

const buildTransactionWhere = (
  filters: TransactionFilters,
) => {
  return {
    ...(filters.status !== undefined && {
      status: filters.status as
        | "PENDING"
        | "PROCESSING"
        | "COMPLETED"
        | "FAILED"
        | "CANCELLED"
        | "REFUNDED",
    }),

    ...(filters.type !== undefined && {
      type: filters.type as
        | "DEPOSIT"
        | "WITHDRAWAL"
        | "INTERNAL_TRANSFER"
        | "EXTERNAL_DEPOSIT"
        | "EXTERNAL_TRANSFER"
        | "FX_CONVERSION"
        | "REFUND",
    }),

    ...(filters.provider !== undefined && {
      provider: filters.provider as
        | "INTERNAL"
        | "BKASH"
        | "NAGAD"
        | "ROCKET"
        | "PAYPAL"
        | "PAYONEER"
        | "WISE",
    }),

    ...(filters.currencyCode !== undefined && {
      currencyCode: filters.currencyCode,
    }),

    ...(filters.userId !== undefined && {
      OR: [
        {
          sourceAccount: {
            userId: filters.userId,
          },
        },
        {
          destinationAccount: {
            userId: filters.userId,
          },
        },
      ],
    }),

    ...(filters.sourceAccountId !== undefined && {
      sourceAccountId: filters.sourceAccountId,
    }),

    ...(filters.destinationAccountId !== undefined && {
      destinationAccountId:
        filters.destinationAccountId,
    }),
  };
};

export const getAuditorTransactions = async (
  user: AuthUser,
  page: number,
  limit: number,
  filters: TransactionFilters = {},
) => {
  assertAuditorPermission(
    user,
    AuditorPermission.TRANSACTION_HISTORY_VIEW,
  );

  const skip = (page - 1) * limit;

  const where = buildTransactionWhere(filters);

  const [transactions, total] = await prisma.$transaction([
    prisma.transaction.findMany({
      where,
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      select: SAFE_AUDITOR_TRANSACTION_SELECT,
    }),

    prisma.transaction.count({
      where,
    }),
  ]);

  return {
    transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAuditorTransactionById = async (
  user: AuthUser,
  transactionId: string,
) => {
  assertAuditorPermission(
    user,
    AuditorPermission.TRANSACTION_HISTORY_VIEW,
  );

  const transaction =
    await prisma.transaction.findUnique({
      where: {
        id: transactionId,
      },
      select: SAFE_AUDITOR_TRANSACTION_SELECT,
    });

  if (!transaction) {
    throw new AppError(
      "Transaction not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return transaction;
};
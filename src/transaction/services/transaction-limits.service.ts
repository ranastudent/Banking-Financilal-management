import { Prisma } from "@prisma/client";

import { env } from "../../config/env";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { getDailyWindow } from "../policies/transaction-limits.policy";

/**
 * Daily limits are scoped to a source account, currency, and local business
 * day. Call these functions only after locking the account's balance row;
 * transfers and withdrawals already do so, serializing same-account writes.
 */
const getDailyOutgoingTotal = async (
  tx: Prisma.TransactionClient,
  args: {
    accountId: string;
    currencyCode: string;
    transactionTypes: Prisma.TransactionWhereInput["type"];
    statuses: Prisma.TransactionWhereInput["status"];
    now?: Date;
  },
): Promise<Prisma.Decimal> => {
  const window = getDailyWindow(
    args.now ?? new Date(),
    env.transactionLimits.timeZone,
  );

  const result = await tx.transaction.aggregate({
    where: {
      sourceAccountId: args.accountId,
      currencyCode: args.currencyCode,
      ...(args.transactionTypes !== undefined
        ? { type: args.transactionTypes }
        : {}),
      ...(args.statuses !== undefined ? { status: args.statuses } : {}),
      createdAt: {
        gte: window.start,
        lt: window.end,
      },
    },
    _sum: {
      amount: true,
    },
  });

  return result._sum?.amount ?? new Prisma.Decimal(0);
};

const ensureDailyLimitNotExceeded = (
  currentTotal: Prisma.Decimal,
  requestedAmount: Prisma.Decimal,
  configuredLimit: string,
  label: string,
): void => {
  const limit = new Prisma.Decimal(configuredLimit);
  const projectedTotal = currentTotal.add(requestedAmount);

  if (projectedTotal.gt(limit)) {
    throw new AppError(
      `${label} exceeded. Daily limit is ${limit.toString()} and current usage is ${currentTotal.toString()}.`,
      409,
      ErrorCode.TRANSACTION_LIMIT_EXCEEDED,
    );
  }
};

export const assertDailyTransferLimit = async (
  tx: Prisma.TransactionClient,
  args: {
    accountId: string;
    currencyCode: string;
    amount: Prisma.Decimal;
    now?: Date;
  },
): Promise<void> => {
  const currentTotal = await getDailyOutgoingTotal(tx, {
    accountId: args.accountId,
    currencyCode: args.currencyCode,
    transactionTypes: {
      in: ["INTERNAL_TRANSFER", "EXTERNAL_TRANSFER"],
    },
    statuses: {
      in: ["COMPLETED"],
    },
    ...(args.now !== undefined ? { now: args.now } : {}),
  });

  ensureDailyLimitNotExceeded(
    currentTotal,
    args.amount,
    env.transactionLimits.dailyTransferLimit,
    "Daily transfer limit",
  );
};

export const assertDailyWithdrawalLimit = async (
  tx: Prisma.TransactionClient,
  args: {
    accountId: string;
    currencyCode: string;
    amount: Prisma.Decimal;
    now?: Date;
  },
): Promise<void> => {
  const currentTotal = await getDailyOutgoingTotal(tx, {
    accountId: args.accountId,
    currencyCode: args.currencyCode,
    transactionTypes: {
      in: ["WITHDRAWAL"],
    },
    // Withdrawals debit the balance when created, so pending and processing
    // withdrawals reserve daily capacity as well as completed withdrawals.
    statuses: {
      in: ["PENDING", "PROCESSING", "COMPLETED"],
    },
    ...(args.now !== undefined ? { now: args.now } : {}),
  });

  ensureDailyLimitNotExceeded(
    currentTotal,
    args.amount,
    env.transactionLimits.dailyWithdrawalLimit,
    "Daily withdrawal limit",
  );
};

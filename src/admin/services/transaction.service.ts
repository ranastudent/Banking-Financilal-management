import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

const SAFE_TRANSACTION_SELECT = {
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

export const getAdminTransactions = async (
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;

  const [transactions, total] = await prisma.$transaction([
    prisma.transaction.findMany({
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      select: SAFE_TRANSACTION_SELECT,
    }),

    prisma.transaction.count(),
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

export const getAdminTransactionById = async (
  transactionId: string,
) => {
  const transaction = await prisma.transaction.findUnique({
    where: {
      id: transactionId,
    },
    select: SAFE_TRANSACTION_SELECT,
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
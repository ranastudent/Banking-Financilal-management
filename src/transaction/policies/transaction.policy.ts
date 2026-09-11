import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

export const getCustomerOwnedTransaction = async (
  transactionId: string,
  userId: string,
) => {
  const transaction = await prisma.transaction.findUnique({
    where: {
      id: transactionId,
    },
  });

  if (!transaction) {
    throw new AppError(
      "Transaction not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  const accountIds = [
    transaction.sourceAccountId,
    transaction.destinationAccountId,
  ].filter((accountId): accountId is string => Boolean(accountId));

  if (accountIds.length === 0) {
    throw new AppError(
      "You do not have permission to access this transaction",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  const ownedAccount = await prisma.account.findFirst({
    where: {
      userId,
      id: {
        in: accountIds,
      },
    },
    select: {
      id: true,
    },
  });

  if (!ownedAccount) {
    throw new AppError(
      "You do not have permission to access this transaction",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  return transaction;
};
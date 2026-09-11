import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { prisma } from "../../config/prisma";

export const getCustomerOwnedAccount = async (
  accountId: string,
  userId: string,
) => {
  const account = await prisma.account.findUnique({
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

  if (account.userId !== userId) {
    throw new AppError(
      "You do not have permission to access this account",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  return account;
};
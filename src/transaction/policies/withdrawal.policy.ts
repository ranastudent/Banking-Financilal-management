import { prisma } from "../../config/prisma";
import { getCustomerOwnedAccount } from "../../account/policies/account.policy";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

export const getWithdrawalAuthorizedAccount = async (
  accountId: string,
  userId: string,
  userRole: string,
) => {
  // CUSTOMER can withdraw only from their own account.
  if (userRole === "CUSTOMER") {
    return getCustomerOwnedAccount(accountId, userId);
  }

  // ADMIN can withdraw from any account.
  if (userRole === "ADMIN") {
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

    return account;
  }

  // SUPPORT and AUDITOR cannot perform withdrawals.
  throw new AppError(
    "You do not have permission to perform a withdrawal",
    403,
    ErrorCode.FORBIDDEN,
  );
};
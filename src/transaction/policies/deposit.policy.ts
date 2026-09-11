import { getCustomerOwnedAccount } from "../../account/policies/account.policy";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { prisma } from "../../config/prisma";

export const getDepositAuthorizedAccount = async (
  accountId: string,
  userId: string,
  userRole: string,
) => {
  /*
   * CUSTOMER:
   * Can deposit only into their own account.
   */
  if (userRole === "CUSTOMER") {
    return getCustomerOwnedAccount(accountId, userId);
  }

  /*
   * ADMIN:
   * Can deposit into any account.
   */
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

  /*
   * SUPPORT and AUDITOR are not allowed
   * to perform deposits.
   */
  throw new AppError(
    "You do not have permission to perform a deposit",
    403,
    ErrorCode.FORBIDDEN,
  );
};
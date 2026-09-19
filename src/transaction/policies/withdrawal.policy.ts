import { prisma } from "../../config/prisma";
import { getCustomerOwnedAccount } from "../../account/policies/account.policy";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getWithdrawalAuthorizedAccount = async (
  accountId: string,
  userId: string,
  userRole: string,
) => {
  if (!UUID_REGEX.test(accountId)) {
    throw new AppError(
      "Invalid account ID",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  if (userRole === "CUSTOMER") {
    return getCustomerOwnedAccount(
      accountId,
      userId,
    );
  }

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

  throw new AppError(
    "You do not have permission to perform a withdrawal",
    403,
    ErrorCode.FORBIDDEN,
  );
};
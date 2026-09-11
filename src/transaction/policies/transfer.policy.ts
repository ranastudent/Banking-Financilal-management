import { prisma } from "../../config/prisma";
import { getCustomerOwnedAccount } from "../../account/policies/account.policy";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

export const getTransferAuthorizedAccounts = async (
  sourceAccountId: string,
  destinationAccountId: string,
  userId: string,
  userRole: string,
) => {
  /*
   * Prevent transferring to the same account.
   *
   * This is a basic request-level/business boundary check.
   */
  if (sourceAccountId === destinationAccountId) {
    throw new AppError(
      "Source and destination accounts must be different",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  /*
   * CUSTOMER:
   * The source account must belong to the authenticated customer.
   */
  if (userRole === "CUSTOMER") {
    const sourceAccount = await getCustomerOwnedAccount(
      sourceAccountId,
      userId,
    );

    const destinationAccount = await prisma.account.findUnique({
      where: {
        id: destinationAccountId,
      },
    });

    if (!destinationAccount) {
      throw new AppError(
        "Destination account not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return {
      sourceAccount,
      destinationAccount,
    };
  }

  /*
   * ADMIN:
   * Admin can initiate transfers involving any existing accounts.
   */
  if (userRole === "ADMIN") {
    const [sourceAccount, destinationAccount] =
      await Promise.all([
        prisma.account.findUnique({
          where: {
            id: sourceAccountId,
          },
        }),
        prisma.account.findUnique({
          where: {
            id: destinationAccountId,
          },
        }),
      ]);

    if (!sourceAccount) {
      throw new AppError(
        "Source account not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (!destinationAccount) {
      throw new AppError(
        "Destination account not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return {
      sourceAccount,
      destinationAccount,
    };
  }

  /*
   * SUPPORT and AUDITOR cannot perform transfers.
   */
  throw new AppError(
    "You do not have permission to perform a transfer",
    403,
    ErrorCode.FORBIDDEN,
  );
};
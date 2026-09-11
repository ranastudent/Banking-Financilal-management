import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { getCustomerOwnedTransaction } from "../policies/transaction.policy";

export const authorizeTransactionView = async (
  transactionId: string,
  userId: string,
  userRole: string,
) => {
  if (userRole === "CUSTOMER") {
    return getCustomerOwnedTransaction(
      transactionId,
      userId,
    );
  }

  if (
    userRole === "ADMIN" ||
    userRole === "SUPPORT" ||
    userRole === "AUDITOR"
  ) {
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

    return transaction;
  }

  throw new AppError(
    "You do not have permission to view this transaction",
    403,
    ErrorCode.FORBIDDEN,
  );
};
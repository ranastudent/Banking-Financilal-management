import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import {
  assertSupportPermission,
  SupportPermission,
} from "../policies/support.policy";

const SAFE_CUSTOMER_ACCOUNT_SELECT = {
  id: true,
  userId: true,
  accountNumber: true,
  accountType: true,
  status: true,
  createdAt: true,
  updatedAt: true,

  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      emailVerifiedAt: true,
    },
  },

  balances: {
    select: {
      id: true,
      currencyCode: true,
      availableBalance: true,
      lockedBalance: true,
      updatedAt: true,

      currency: {
        select: {
          code: true,
          name: true,
          symbol: true,
          decimalPlaces: true,
          isActive: true,
        },
      },
    },
    orderBy: {
      currencyCode: "asc" as const,
    },
  },
} as const;

export const getSupportCustomerAccount = async (
  user: AuthUser,
  accountId: string,
) => {
  assertSupportPermission(
    user,
    SupportPermission.CUSTOMER_ACCOUNT_VIEW,
  );

  /*
   * Deliberately require the related user to be CUSTOMER.
   *
   * This means:
   * - real customer account -> returned
   * - ADMIN account -> 404
   * - SUPPORT account -> 404
   * - AUDITOR account -> 404
   * - nonexistent account -> 404
   *
   * We therefore do not reveal whether a non-customer account exists.
   */
  const account = await prisma.account.findFirst({
    where: {
      id: accountId,
      user: {
        role: "CUSTOMER",
      },
    },
    select: SAFE_CUSTOMER_ACCOUNT_SELECT,
  });

  if (!account) {
    throw new AppError(
      "Customer account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return account;
};
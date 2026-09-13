import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import {
  assertSupportPermission,
  SupportPermission,
} from "../policies/support.policy";

const SAFE_CUSTOMER_TRANSACTION_SELECT = {
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

type TransactionFilters = {
  status?: string;
  type?: string;
  provider?: string;
  currencyCode?: string;
};

export const getSupportCustomerTransactions = async (
  user: AuthUser,
  customerId: string,
  page: number,
  limit: number,
  filters: TransactionFilters = {},
) => {
  assertSupportPermission(
    user,
    SupportPermission.CUSTOMER_TRANSACTION_VIEW,
  );

  const skip = (page - 1) * limit;

  return prisma.$transaction(async (tx) => {
    /*
     * Explicitly verify that the requested user is a CUSTOMER.
     *
     * We deliberately return the same 404 for:
     * - nonexistent user
     * - ADMIN
     * - SUPPORT
     * - AUDITOR
     *
     * This prevents role/resource enumeration.
     */
    const customer = await tx.user.findFirst({
      where: {
        id: customerId,
        role: "CUSTOMER",
      },
      select: {
        id: true,
      },
    });

    if (!customer) {
      throw new AppError(
        "Customer not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const accounts = await tx.account.findMany({
      where: {
        userId: customer.id,
      },
      select: {
        id: true,
      },
    });

    const accountIds = accounts.map(
      (account) => account.id,
    );

    /*
     * A customer with no accounts has no customer transactions.
     */
    if (accountIds.length === 0) {
      return {
        transactions: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    const where = {
      OR: [
        {
          sourceAccountId: {
            in: accountIds,
          },
        },
        {
          destinationAccountId: {
            in: accountIds,
          },
        },
      ],

      ...(filters.status !== undefined && {
        status: filters.status as
          | "PENDING"
          | "PROCESSING"
          | "COMPLETED"
          | "FAILED"
          | "CANCELLED"
          | "REFUNDED",
      }),

      ...(filters.type !== undefined && {
        type: filters.type as
          | "DEPOSIT"
          | "WITHDRAWAL"
          | "INTERNAL_TRANSFER"
          | "EXTERNAL_DEPOSIT"
          | "EXTERNAL_TRANSFER"
          | "FX_CONVERSION"
          | "REFUND",
      }),

      ...(filters.provider !== undefined && {
        provider: filters.provider as
          | "INTERNAL"
          | "BKASH"
          | "NAGAD"
          | "ROCKET"
          | "PAYPAL"
          | "PAYONEER"
          | "WISE",
      }),

      ...(filters.currencyCode !== undefined && {
        currencyCode: filters.currencyCode,
      }),
    };

    const [transactions, total] = await Promise.all([
      tx.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
        select: SAFE_CUSTOMER_TRANSACTION_SELECT,
      }),

      tx.transaction.count({
        where,
      }),
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
  });
};
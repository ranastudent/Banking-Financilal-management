import {
  Prisma,
  UserRole,
} from "@prisma/client";

import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

import type { TransactionHistoryQuery } from "../validation/transaction-history-query";

// ============================================================
// TYPES
// ============================================================

type TransactionHistoryUser = {
  id: string;
  role: string;
};

type TransactionHistoryResult = {
  transactions: Prisma.TransactionGetPayload<object>[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

// ============================================================
// SERVICE
// ============================================================

/**
 * Retrieves paginated transaction history for an authenticated user.
 *
 * Access rules:
 *
 * CUSTOMER:
 *   Can see transactions associated with their own accounts.
 *
 * ADMIN:
 *   Can see all transactions.
 *
 * AUDITOR:
 *   Can see all transactions.
 *
 * SUPPORT:
 *   Can see transactions involving customer accounts.
 *
 * The query must already have passed transactionHistoryQuerySchema
 * validation before reaching this service.
 */
export const getTransactionHistory = async (
  user: TransactionHistoryUser,
  query: TransactionHistoryQuery,
): Promise<TransactionHistoryResult> => {
  // ----------------------------------------------------------
  // 1. Validate the user's role
  // ----------------------------------------------------------

  const allowedRoles: UserRole[] = [
    UserRole.CUSTOMER,
    UserRole.ADMIN,
    UserRole.SUPPORT,
    UserRole.AUDITOR,
  ];

  if (
    !allowedRoles.includes(user.role as UserRole)
  ) {
    throw new AppError(
      "You do not have permission to view transaction history",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  // ----------------------------------------------------------
  // 2. Calculate pagination
  // ----------------------------------------------------------

  const { page, limit } = query;

  const skip = (page - 1) * limit;

  if (!Number.isSafeInteger(skip)) {
    throw new AppError(
      "Requested page exceeds the supported range",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  // ----------------------------------------------------------
  // 3. Build transaction filters
  // ----------------------------------------------------------

  const where: Prisma.TransactionWhereInput = {};

  if (query.type !== undefined) {
    where.type = query.type;
  }

  if (query.status !== undefined) {
    where.status = query.status;
  }

  if (query.startDate !== undefined || query.endDate !== undefined) {
    const createdAt: Prisma.DateTimeFilter = {};

    if (query.startDate !== undefined) {
      createdAt.gte = new Date(
        `${query.startDate}T00:00:00.000Z`,
      );
    }

    if (query.endDate !== undefined) {
      const exclusiveEndDate = new Date(
        `${query.endDate}T00:00:00.000Z`,
      );

      exclusiveEndDate.setUTCDate(
        exclusiveEndDate.getUTCDate() + 1,
      );

      createdAt.lt = exclusiveEndDate;
    }

    where.createdAt = createdAt;
  }

  if (
    query.minAmount !== undefined ||
    query.maxAmount !== undefined
  ) {
    const amount: Prisma.DecimalFilter = {};

    if (query.minAmount !== undefined) {
      amount.gte = new Prisma.Decimal(query.minAmount);
    }

    if (query.maxAmount !== undefined) {
      amount.lte = new Prisma.Decimal(query.maxAmount);
    }

    where.amount = amount;
  }

  // ----------------------------------------------------------
  // 4. Apply role-based access restrictions
  // ----------------------------------------------------------

  if (user.role === UserRole.CUSTOMER) {
    const ownedAccounts = await prisma.account.findMany({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
      },
    });

    const accountIds = ownedAccounts.map(
      (account) => account.id,
    );

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

    const ownershipConditions: Prisma.TransactionWhereInput[] = [
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
      {
        legs: {
          some: {
            accountId: {
              in: accountIds,
            },
          },
        },
      },
      {
        ledgerEntries: {
          some: {
            accountId: {
              in: accountIds,
            },
          },
        },
      },
    ];

    where.AND = [
      ...(where.AND
        ? Array.isArray(where.AND)
          ? where.AND
          : [where.AND]
        : []),
      {
        OR: ownershipConditions,
      },
    ];
  }

  if (user.role === UserRole.SUPPORT) {
    const supportCondition: Prisma.TransactionWhereInput = {
      OR: [
        {
          sourceAccount: {
            user: {
              role: UserRole.CUSTOMER,
            },
          },
        },
        {
          destinationAccount: {
            user: {
              role: UserRole.CUSTOMER,
            },
          },
        },
        {
          legs: {
            some: {
              account: {
                user: {
                  role: UserRole.CUSTOMER,
                },
              },
            },
          },
        },
        {
          ledgerEntries: {
            some: {
              account: {
                user: {
                  role: UserRole.CUSTOMER,
                },
              },
            },
          },
        },
      ],
    };

    where.AND = [
      ...(where.AND
        ? Array.isArray(where.AND)
          ? where.AND
          : [where.AND]
        : []),
      supportCondition,
    ];
  }

  // ----------------------------------------------------------
  // 5. Apply account filter
  // ----------------------------------------------------------

  if (query.accountId !== undefined) {
    if (user.role === UserRole.CUSTOMER) {
      const ownedAccount = await prisma.account.findFirst({
        where: {
          id: query.accountId,
          userId: user.id,
        },
        select: {
          id: true,
        },
      });

      if (!ownedAccount) {
        throw new AppError(
          "You do not have permission to access this account",
          403,
          ErrorCode.FORBIDDEN,
        );
      }
    }

    const accountCondition: Prisma.TransactionWhereInput = {
      OR: [
        {
          sourceAccountId: query.accountId,
        },
        {
          destinationAccountId: query.accountId,
        },
        {
          legs: {
            some: {
              accountId: query.accountId,
            },
          },
        },
        {
          ledgerEntries: {
            some: {
              accountId: query.accountId,
            },
          },
        },
      ],
    };

    where.AND = [
      ...(where.AND
        ? Array.isArray(where.AND)
          ? where.AND
          : [where.AND]
        : []),
      accountCondition,
    ];
  }

  // ----------------------------------------------------------
  // 6. Fetch transactions and count matching records
  // ----------------------------------------------------------

  const [transactions, total] = await prisma.$transaction([
    prisma.transaction.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
    }),

    prisma.transaction.count({
      where,
    }),
  ]);

  // ----------------------------------------------------------
  // 7. Calculate pagination metadata
  // ----------------------------------------------------------

  const totalPages = Math.ceil(total / limit);

  // ----------------------------------------------------------
  // 8. Return the result
  // ----------------------------------------------------------

  return {
    transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};
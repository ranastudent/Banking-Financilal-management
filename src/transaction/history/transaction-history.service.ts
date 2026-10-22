import {
  Prisma,
  UserRole,
} from "@prisma/client";

import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

import type {
  TransactionHistoryQuery,
  TransactionPaginationMode,
} from "../validation/transaction-history-query";

// ============================================================
// TYPES
// ============================================================

type TransactionHistoryUser = {
  id: string;
  role: string;
};

type TransactionRecord =
  Prisma.TransactionGetPayload<object>;

type OffsetPagination = {
  mode: "offset";
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type CursorPagination = {
  mode: "cursor";
  limit: number;
  hasNextPage: boolean;
  nextCursor: string | null;
};

type TransactionHistoryResult = {
  transactions: TransactionRecord[];
  pagination: OffsetPagination | CursorPagination;
};

type TransactionCursor = {
  createdAt: Date;
  id: string;
};

type CursorPayload = {
  createdAt: string;
  id: string;
};

// ============================================================
// CURSOR HELPERS
// ============================================================

const CURSOR_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Encodes a transaction's position as an opaque Base64URL token.
 */
const encodeCursor = (
  transaction: Pick<TransactionRecord, "createdAt" | "id">,
): string => {
  const payload: CursorPayload = {
    createdAt: transaction.createdAt.toISOString(),
    id: transaction.id,
  };

  return Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");
};

/**
 * Decodes and validates a cursor token.
 *
 * The token is a pagination position, not an authorization token.
 * Every database query must still apply role and ownership rules.
 */
const decodeCursor = (
  token: string,
): TransactionCursor => {
  try {
    const decoded = Buffer.from(
      token,
      "base64url",
    ).toString("utf8");

    const payload: unknown = JSON.parse(decoded);

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("createdAt" in payload) ||
      !("id" in payload)
    ) {
      throw new Error("Invalid cursor payload");
    }

    const candidate = payload as {
      createdAt: unknown;
      id: unknown;
    };

    if (
      typeof candidate.createdAt !== "string" ||
      typeof candidate.id !== "string"
    ) {
      throw new Error("Invalid cursor fields");
    }

    if (!CURSOR_UUID_PATTERN.test(candidate.id)) {
      throw new Error("Invalid transaction ID");
    }

    const createdAt = new Date(candidate.createdAt);

    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== candidate.createdAt
    ) {
      throw new Error("Invalid cursor timestamp");
    }

    return {
      createdAt,
      id: candidate.id,
    };
  } catch {
    throw new AppError(
      "Invalid transaction history cursor",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }
};

// ============================================================
// QUERY HELPERS
// ============================================================

/**
 * Appends an AND condition without discarding existing filters.
 */
const appendAndCondition = (
  where: Prisma.TransactionWhereInput,
  condition: Prisma.TransactionWhereInput,
): void => {
  const existingConditions = where.AND
    ? Array.isArray(where.AND)
      ? where.AND
      : [where.AND]
    : [];

  where.AND = [
    ...existingConditions,
    condition,
  ];
};

// ============================================================
// SERVICE
// ============================================================

/**
 * Retrieves paginated transaction history.
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
 * The query must have passed transactionHistoryQuerySchema
 * validation before reaching this service.
 */
export const getTransactionHistory = async (
  user: TransactionHistoryUser,
  query: TransactionHistoryQuery,
  paginationMode: TransactionPaginationMode = "offset",
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

  if (!allowedRoles.includes(user.role as UserRole)) {
    throw new AppError(
      "You do not have permission to view transaction history",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  const { page, limit } = query;

  // ----------------------------------------------------------
  // 2. Validate pagination inputs
  // ----------------------------------------------------------

  let skip = 0;

  if (paginationMode === "offset") {
    skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      throw new AppError(
        "Requested page exceeds the supported range",
        400,
        ErrorCode.BAD_REQUEST,
      );
    }
  }

  const cursor = query.cursor
    ? decodeCursor(query.cursor)
    : undefined;

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

  if (
    query.startDate !== undefined ||
    query.endDate !== undefined
  ) {
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
      amount.gte = new Prisma.Decimal(
        query.minAmount,
      );
    }

    if (query.maxAmount !== undefined) {
      amount.lte = new Prisma.Decimal(
        query.maxAmount,
      );
    }

    where.amount = amount;
  }

  // ----------------------------------------------------------
  // 4. Apply customer account ownership restrictions
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
      if (paginationMode === "cursor") {
        return {
          transactions: [],
          pagination: {
            mode: "cursor",
            limit,
            hasNextPage: false,
            nextCursor: null,
          },
        };
      }

      return {
        transactions: [],
        pagination: {
          mode: "offset",
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

    appendAndCondition(where, {
      OR: ownershipConditions,
    });
  }

  // ----------------------------------------------------------
  // 5. Apply support-role restrictions
  // ----------------------------------------------------------

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

    appendAndCondition(
      where,
      supportCondition,
    );
  }

  // ----------------------------------------------------------
  // 6. Apply account filter
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

    appendAndCondition(
      where,
      accountCondition,
    );
  }

  // ----------------------------------------------------------
  // 7. Apply cursor condition
  // ----------------------------------------------------------

  if (
    paginationMode === "cursor" &&
    cursor !== undefined
  ) {
    const cursorCondition: Prisma.TransactionWhereInput = {
      OR: [
        {
          createdAt: {
            lt: cursor.createdAt,
          },
        },
        {
          createdAt: cursor.createdAt,
          id: {
            lt: cursor.id,
          },
        },
      ],
    };

    appendAndCondition(
      where,
      cursorCondition,
    );
  }

  // ----------------------------------------------------------
  // 8. Fetch transactions
  // ----------------------------------------------------------

  const orderBy: Prisma.TransactionOrderByWithRelationInput[] = [
    {
      createdAt: "desc",
    },
    {
      id: "desc",
    },
  ];

  if (paginationMode === "cursor") {
    const fetchedTransactions =
      await prisma.transaction.findMany({
        where,
        take: limit + 1,
        orderBy,
      });

    const hasNextPage =
      fetchedTransactions.length > limit;

    const transactions =
      fetchedTransactions.slice(0, limit);

    const lastTransaction =
      transactions.length > 0
        ? transactions[transactions.length - 1]
        : undefined;

    const nextCursor =
      hasNextPage && lastTransaction
        ? encodeCursor(lastTransaction)
        : null;

    return {
      transactions,
      pagination: {
        mode: "cursor",
        limit,
        hasNextPage,
        nextCursor,
      },
    };
  }

  // ----------------------------------------------------------
  // 9. Offset pagination
  // ----------------------------------------------------------

  const [transactions, total] =
    await prisma.$transaction([
      prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),

      prisma.transaction.count({
        where,
      }),
    ]);

  // ----------------------------------------------------------
  // 10. Calculate offset metadata
  // ----------------------------------------------------------

  const totalPages = Math.ceil(
    total / limit,
  );

  // ----------------------------------------------------------
  // 11. Return offset result
  // ----------------------------------------------------------

  return {
    transactions,
    pagination: {
      mode: "offset",
      page,
      limit,
      total,
      totalPages,
    },
  };
};
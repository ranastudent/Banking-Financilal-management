import { randomInt } from "crypto";

import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import type { CreateAccountInput } from "../schemas/account.schema";
import { getCustomerOwnedAccount } from "../policies/account.policy";
import { Prisma } from "@prisma/client";


const MAX_ACCOUNT_NUMBER_ATTEMPTS = 5;

const generateAccountNumber = (): string => {
  /*
   * Generate a 16-digit account number.
   *
   * The number is represented as a string because account numbers
   * are identifiers, not values used for arithmetic.
   */
  const firstPart = randomInt(10_000_000, 100_000_000);
  const secondPart = randomInt(100_000_000, 1_000_000_000);

  return `${firstPart}${secondPart}`;
};

const createAccountRecord = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  input: CreateAccountInput,
) => {
  const user = await tx.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      role: true,
      status: true,
    },
  });

  if (!user) {
    throw new AppError(
      "User not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  if (user.role !== "CUSTOMER") {
    throw new AppError(
      "Only CUSTOMER users can create accounts",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  if (user.status !== "ACTIVE") {
    throw new AppError(
      "Only active users can create accounts",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  const currency = await tx.currency.findUnique({
    where: {
      code: input.currency,
    },
    select: {
      code: true,
      isActive: true,
    },
  });

  if (!currency) {
    throw new AppError(
      "Currency not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  if (!currency.isActive) {
    throw new AppError(
      "Currency is inactive",
      409,
      ErrorCode.CONFLICT,
    );
  }

  for (
    let attempt = 0;
    attempt < MAX_ACCOUNT_NUMBER_ATTEMPTS;
    attempt += 1
  ) {
    const accountNumber = generateAccountNumber();

    try {
      const account = await tx.account.create({
        data: {
          userId,
          accountNumber,
          accountType: input.accountType,
          status: "ACTIVE",

          balances: {
            create: {
              currencyCode: currency.code,
              availableBalance: 0,
              lockedBalance: 0,
            },
          },
        },
        select: {
          id: true,
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
            },
          },

          balances: {
            select: {
              currencyCode: true,
              availableBalance: true,
              lockedBalance: true,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: "ACCOUNT_CREATED",
          entityType: "ACCOUNT",
          entityId: account.id,
          description: `Account ${account.accountNumber} was created.`,
          metadata: {
            accountType: account.accountType,
            currency: currency.code,
          },
        },
      });

      return account;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "P2002"
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new AppError(
    "Unable to generate a unique account number",
    409,
    ErrorCode.CONFLICT,
  );
};

export const createCustomerAccount = async (
  user: AuthUser,
  input: CreateAccountInput,
) => {
  return prisma.$transaction((tx) =>
    createAccountRecord(tx, user.id, input),
  );
};

const CUSTOMER_ACCOUNT_SELECT = {
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
        },
      },
    },
    orderBy: {
      currencyCode: "asc" as const,
    },
  },
} as const;

export const getCustomerAccounts = async (
  userId: string,
) => {
  return prisma.account.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: CUSTOMER_ACCOUNT_SELECT,
  });
};

export const getCustomerAccountById = async (
  accountId: string,
  userId: string,
) => {
  // Reuse the existing ownership policy.
  await getCustomerOwnedAccount(accountId, userId);

  const account = await prisma.account.findUnique({
    where: {
      id: accountId,
    },
    select: CUSTOMER_ACCOUNT_SELECT,
  });

  if (!account) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return account;
};

const lockAccountForStatusUpdate = async (
  tx: Prisma.TransactionClient,
  accountId: string,
) => {
  /*
   * Canonical account locking protocol:
   *
   * Account
   *   ↓
   * AccountBalance
   *
   * Financial operations use:
   *   Account FOR SHARE
   *   ↓
   *   AccountBalance FOR UPDATE
   *
   * Status operations use:
   *   Account FOR UPDATE
   *   ↓
   *   AccountBalance FOR UPDATE
   *
   * Keeping the same lock order prevents lock-order inversion.
   */

  const accountRows = await tx.$queryRaw<
    Array<{
      id: string;
      userId: string;
      accountNumber: string;
      accountType: string;
      status: string;
    }>
  >`
    SELECT
      id,
      user_id AS "userId",
      account_number AS "accountNumber",
      account_type AS "accountType",
      status
    FROM accounts
    WHERE id = CAST(${accountId} AS uuid)
    FOR UPDATE
  `;

  const account = accountRows[0];

  if (!account) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  /*
   * Lock all existing balances for this account.
   *
   * ORDER BY currency_code gives deterministic ordering
   * when multiple balance rows exist.
   */
  await tx.$queryRaw`
    SELECT
      id
    FROM account_balances
    WHERE account_id = CAST(${accountId} AS uuid)
    ORDER BY currency_code ASC
    FOR UPDATE
  `;

  return account;
};

export const updateCustomerAccountStatus = async (
  accountId: string,
  userId: string,
  status: "ACTIVE" | "FROZEN" | "CLOSED",
  ipAddress?: string,
  userAgent?: string,
) => {
  /*
   * This initial ownership check remains outside the transaction
   * for fast rejection of unauthorized requests.
   *
   * The account status itself MUST be re-read inside the
   * transaction because the outside read can become stale.
   */
  const account = await getCustomerOwnedAccount(
    accountId,
    userId,
  );

  /*
   * CLOSED is terminal based on the current snapshot.
   *
   * We will also re-check this inside the transaction after
   * acquiring the canonical Account lock.
   */
  if (account.status === "CLOSED") {
    throw new AppError(
      "Closed account cannot be modified",
      409,
      ErrorCode.CONFLICT,
    );
  }

  /*
   * No actual status change.
   *
   * This remains a read-only fast path.
   */
  if (account.status === status) {
    return prisma.account.findUnique({
      where: {
        id: accountId,
      },
      select: {
        id: true,
        userId: true,
        accountNumber: true,
        accountType: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  const updatedAccount = await prisma.$transaction(
    async (tx) => {
      /*
       * ======================================================
       * 1. CANONICAL ACCOUNT LOCK
       * ======================================================
       *
       * Status operation:
       *
       * Account FOR UPDATE
       *       ↓
       * AccountBalance FOR UPDATE
       *
       * Financial operation:
       *
       * Account FOR SHARE
       *       ↓
       * AccountBalance FOR UPDATE
       *
       * Both operations therefore follow:
       *
       * Account → AccountBalance
       */
      const lockedAccount =
        await lockAccountForStatusUpdate(
          tx,
          accountId,
        );

      /*
       * ======================================================
       * 2. RE-CHECK CURRENT STATUS
       * ======================================================
       *
       * The status read performed before the transaction may
       * now be stale. The locked row is authoritative.
       */
      if (lockedAccount.status === "CLOSED") {
        throw new AppError(
          "Closed account cannot be modified",
          409,
          ErrorCode.CONFLICT,
        );
      }

      /*
       * Another concurrent request may already have changed
       * the status while the original request was waiting.
       */
      if (lockedAccount.status === status) {
        return tx.account.findUnique({
          where: {
            id: accountId,
          },
          select: {
            id: true,
            userId: true,
            accountNumber: true,
            accountType: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      }

      /*
       * ======================================================
       * 3. UPDATE ACCOUNT STATUS
       * ======================================================
       */
      const updated = await tx.account.update({
        where: {
          id: accountId,
        },
        data: {
          status,
        },
        select: {
          id: true,
          userId: true,
          accountNumber: true,
          accountType: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      /*
       * ======================================================
       * 4. AUDIT LOG
       * ======================================================
       */
      await tx.auditLog.create({
        data: {
          userId,
          action: "ACCOUNT_STATUS_CHANGED",
          entityType: "ACCOUNT",
          entityId: accountId,
          description:
            `Account ${lockedAccount.accountNumber} status changed ` +
            `from ${lockedAccount.status} to ${status}.`,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          metadata: {
            previousStatus: lockedAccount.status,
            newStatus: status,
          },
        },
      });

      return updated;
    },
  );

  return updatedAccount;
};
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { prepareWithdrawal } from "../../transaction/services/withdrawal.service";
import type { AuthUser } from "../../types/auth";

describe("13.11 Withdrawal Transaction Creation", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
  });

  afterEach(async () => {
    /*
     * Ledger entries depend on transactions.
     */
    if (createdTransactionIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      await prisma.transaction.deleteMany({
        where: {
          id: {
            in: createdTransactionIds,
          },
        },
      });
    }

    /*
     * AccountBalance depends on Account.
     */
    if (createdAccountIds.length > 0) {
      await prisma.accountBalance.deleteMany({
        where: {
          accountId: {
            in: createdAccountIds,
          },
        },
      });

      await prisma.account.deleteMany({
        where: {
          id: {
            in: createdAccountIds,
          },
        },
      });
    }

    /*
     * User-dependent rows.
     */
    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

      await prisma.emailVerificationOtp.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

      await prisma.auditLog.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

      await prisma.user.deleteMany({
        where: {
          id: {
            in: createdUserIds,
          },
        },
      });
    }
  });

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Withdrawal Transaction ${Date.now()}`,
        email: `withdrawal-transaction-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "test-password-hash",
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    createdUserIds.push(user.id);

    return user;
  };

  const createAccount = async (
    userId: string,
  ) => {
    const account = await prisma.account.create({
      data: {
        userId,
        accountNumber: `WD-TX-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    return account;
  };

  const createBalance = async (
    accountId: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance:
          new Prisma.Decimal("10000.00"),
        lockedBalance:
          new Prisma.Decimal("500.00"),
      },
    });
  };

  const buildAuthUser = (
    user: Awaited<
      ReturnType<typeof createUser>
    >,
  ): AuthUser => ({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });

  it("should create a WITHDRAWAL transaction after a successful debit", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    await createBalance(account.id);

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "3000.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    expect(
      result.transaction.id,
    ).toEqual(expect.any(String));

    expect(
      result.transaction.reference,
    ).toMatch(/^WDL-/);

    expect(
      result.transaction.type,
    ).toBe("WITHDRAWAL");

    expect(
      result.transaction.status,
    ).toBe("PENDING");

    expect(
      result.transaction.amount,
    ).toBe("3000");

    expect(
      result.transaction.currencyCode,
    ).toBe("BDT");

    expect(
      result.transaction.sourceAccountId,
    ).toBe(account.id);

    expect(
      result.transaction.destinationAccountId,
    ).toBeNull();

    expect(
      result.transaction.provider,
    ).toBe("INTERNAL");
  });

  it("should persist the transaction in the database", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    await createBalance(account.id);

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "1500.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    const transaction =
      await prisma.transaction.findUnique({
        where: {
          id: result.transaction.id,
        },
      });

    expect(transaction).not.toBeNull();

    expect(transaction?.type).toBe(
      "WITHDRAWAL",
    );

    expect(transaction?.status).toBe(
      "PENDING",
    );

    expect(
      transaction?.amount.toString(),
    ).toBe("1500");

    expect(
      transaction?.currencyCode,
    ).toBe("BDT");

    expect(
      transaction?.sourceAccountId,
    ).toBe(account.id);

    expect(
      transaction?.destinationAccountId,
    ).toBeNull();

    expect(
      transaction?.provider,
    ).toBe("INTERNAL");
  });
});
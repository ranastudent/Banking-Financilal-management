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

describe("13.12 Withdrawal Ledger Entry", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];
  const createdLedgerEntryIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
    createdLedgerEntryIds.length = 0;
  });

  afterEach(async () => {
    if (createdLedgerEntryIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: {
          id: {
            in: createdLedgerEntryIds,
          },
        },
      });
    }

    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({
        where: {
          id: {
            in: createdTransactionIds,
          },
        },
      });
    }

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
        name: `Withdrawal Ledger ${Date.now()}`,
        email: `withdrawal-ledger-${Date.now()}-${Math.random()}@example.com`,
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
        accountNumber: `WD-LGR-${Date.now()}-${Math.random()
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

  it("should create a DEBIT ledger entry for a withdrawal", async () => {
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

    createdLedgerEntryIds.push(
      result.ledgerEntry.id,
    );

    expect(
      result.ledgerEntry.id,
    ).toEqual(expect.any(String));

    expect(
      result.ledgerEntry.transactionId,
    ).toBe(result.transaction.id);

    expect(
      result.ledgerEntry.accountId,
    ).toBe(account.id);

    expect(
      result.ledgerEntry.currencyCode,
    ).toBe("BDT");

    expect(
      result.ledgerEntry.entryType,
    ).toBe("DEBIT");

    expect(
      result.ledgerEntry.amount,
    ).toBe("3000");

    expect(
      result.ledgerEntry.balanceBefore,
    ).toBe("10000");

    expect(
      result.ledgerEntry.balanceAfter,
    ).toBe("7000");
  });

  it("should persist the ledger entry with the correct balance history", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    const balance =
      await createBalance(account.id);

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "2500.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    createdLedgerEntryIds.push(
      result.ledgerEntry.id,
    );

    const ledgerEntry =
      await prisma.ledgerEntry.findUnique({
        where: {
          id: result.ledgerEntry.id,
        },
      });

    const balanceAfter =
      await prisma.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

    expect(ledgerEntry).not.toBeNull();

    expect(
      ledgerEntry?.transactionId,
    ).toBe(result.transaction.id);

    expect(
      ledgerEntry?.accountId,
    ).toBe(account.id);

    expect(
      ledgerEntry?.currencyCode,
    ).toBe("BDT");

    expect(
      ledgerEntry?.entryType,
    ).toBe("DEBIT");

    expect(
      ledgerEntry?.amount.toString(),
    ).toBe("2500");

    expect(
      ledgerEntry?.balanceBefore.toString(),
    ).toBe("10000");

    expect(
      ledgerEntry?.balanceAfter.toString(),
    ).toBe("7500");

    expect(
      balanceAfter?.availableBalance.toString(),
    ).toBe("7500");

    expect(
      balanceAfter?.lockedBalance.toString(),
    ).toBe("500");
  });
});
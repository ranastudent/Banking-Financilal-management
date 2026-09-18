import { afterEach, describe, expect, it } from "vitest";
import { Prisma, UserRole, UserStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { prepareDeposit } from "../../transaction/services/deposit.service";
import { hashPassword } from "../../auth/utils/password";
import type { AuthUser } from "../../types/auth";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

const createTestUser = async () => {
  const user = await prisma.user.create({
    data: {
      name: `Deposit Rollback User ${Date.now()}-${Math.random()}`,
      email: `deposit-rollback-${Date.now()}-${Math.random()}@test.local`,
      passwordHash: await hashPassword(
        "TestPassword123!",
      ),
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createTestAccount = async (
  userId: string,
  balance = "10000.00",
) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `DROLL-${Date.now()}-${Math.floor(
        Math.random() * 100000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  await prisma.accountBalance.create({
    data: {
      accountId: account.id,
      currencyCode: "BDT",
      availableBalance: new Prisma.Decimal(balance),
      lockedBalance: new Prisma.Decimal("0"),
    },
  });

  return account;
};

const createAuthUser = (
  user: Awaited<ReturnType<typeof createTestUser>>,
): AuthUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  status: user.status,
});

afterEach(async () => {
  if (createdAccountIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

    await prisma.ledgerEntry.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });

    await prisma.transactionLeg.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });

    await prisma.transaction.deleteMany({
      where: {
        OR: [
          {
            sourceAccountId: {
              in: createdAccountIds,
            },
          },
          {
            destinationAccountId: {
              in: createdAccountIds,
            },
          },
        ],
      },
    });

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

    createdAccountIds.length = 0;
  }

  if (createdUserIds.length > 0) {
    await prisma.idempotencyRecord.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

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

    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds,
        },
      },
    });

    createdUserIds.length = 0;
  }
});

describe("12.10 Deposit Rollback / Failure Handling", () => {
  it("should rollback transaction when failure occurs after transaction creation", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(
      user.id,
      "10000.00",
    );

    await expect(
      prepareDeposit(
        createAuthUser(user),
        account.id,
        {
          amount: "500.00",
          currency: "BDT",
        },
        {
          failurePoint: "after-transaction",
        },
      ),
    ).rejects.toThrow(
      "Simulated deposit failure at after-transaction",
    );

    const balance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: account.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error(
        "Expected account balance was not found",
      );
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("10000.00"),
      ),
    ).toBe(true);

    const transactions =
      await prisma.transaction.findMany({
        where: {
          destinationAccountId: account.id,
          type: "DEPOSIT",
        },
      });

    expect(transactions).toHaveLength(0);
  });

  it("should rollback transaction and balance when failure occurs after balance update", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(
      user.id,
      "10000.00",
    );

    await expect(
      prepareDeposit(
        createAuthUser(user),
        account.id,
        {
          amount: "500.00",
          currency: "BDT",
        },
        {
          failurePoint: "after-balance",
        },
      ),
    ).rejects.toThrow(
      "Simulated deposit failure at after-balance",
    );

    const balance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: account.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error(
        "Expected account balance was not found",
      );
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("10000.00"),
      ),
    ).toBe(true);

    const transactions =
      await prisma.transaction.findMany({
        where: {
          destinationAccountId: account.id,
          type: "DEPOSIT",
        },
      });

    expect(transactions).toHaveLength(0);

    const ledgerEntries =
      await prisma.ledgerEntry.findMany({
        where: {
          accountId: account.id,
        },
      });

    expect(ledgerEntries).toHaveLength(0);
  });

  it("should rollback transaction, balance, and ledger when failure occurs after ledger creation", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(
      user.id,
      "10000.00",
    );

    await expect(
      prepareDeposit(
        createAuthUser(user),
        account.id,
        {
          amount: "750.00",
          currency: "BDT",
        },
        {
          failurePoint: "after-ledger",
        },
      ),
    ).rejects.toThrow(
      "Simulated deposit failure at after-ledger",
    );

    const balance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: account.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error(
        "Expected account balance was not found",
      );
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("10000.00"),
      ),
    ).toBe(true);

    const transactions =
      await prisma.transaction.findMany({
        where: {
          destinationAccountId: account.id,
          type: "DEPOSIT",
        },
      });

    expect(transactions).toHaveLength(0);

    const ledgerEntries =
      await prisma.ledgerEntry.findMany({
        where: {
          accountId: account.id,
        },
      });

    expect(ledgerEntries).toHaveLength(0);
  });

  it("should rollback everything when failure occurs after audit log creation", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(
      user.id,
      "10000.00",
    );

    await expect(
      prepareDeposit(
        createAuthUser(user),
        account.id,
        {
          amount: "1250.00",
          currency: "BDT",
        },
        {
          failurePoint: "after-audit",
        },
      ),
    ).rejects.toThrow(
      "Simulated deposit failure at after-audit",
    );

    const balance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: account.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error(
        "Expected account balance was not found",
      );
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("10000.00"),
      ),
    ).toBe(true);

    const transactions =
      await prisma.transaction.findMany({
        where: {
          destinationAccountId: account.id,
          type: "DEPOSIT",
        },
      });

    expect(transactions).toHaveLength(0);

    const ledgerEntries =
      await prisma.ledgerEntry.findMany({
        where: {
          accountId: account.id,
        },
      });

    expect(ledgerEntries).toHaveLength(0);

    const auditLogs =
      await prisma.auditLog.findMany({
        where: {
          userId: user.id,
          action: "DEPOSIT_CREATED",
        },
      });

    expect(auditLogs).toHaveLength(0);
  });
});
import { describe, expect, it, afterAll } from "vitest";

import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { prepareDeposit } from "../../transaction/services/deposit.service";
import { AppError } from "../../errors/AppError";
import type { AuthUser } from "../../types/auth";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdTransactionIds: string[] = [];

const createTestUser = async () => {
  const user = await prisma.user.create({
    data: {
      name: `Deposit Balance User ${Date.now()}-${Math.random()}`,
      email: `deposit-balance-${Date.now()}-${Math.random()}@test.local`,
      passwordHash: "test-password-hash",
      role: "CUSTOMER",
      status: "ACTIVE",
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createTestAccount = async (userId: string) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `DBAL-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

describe("Deposit Balance Update", () => {
  it("should increase existing available balance", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    const currency = await prisma.currency.findUnique({
      where: {
        code: "BDT",
      },
      select: {
        code: true,
        isActive: true,
      },
    });

    expect(currency).not.toBeNull();
    expect(currency?.isActive).toBe(true);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("10000.50"),
        lockedBalance: new Prisma.Decimal("500.00"),
      },
    });

    const result = await prepareDeposit(
      {
        id: user.id,
        role: "CUSTOMER",
      } as AuthUser,
      account.id,
      {
        amount: "2500.25",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    expect(
    new Prisma.Decimal(result.balance.balanceBefore).eq(
        new Prisma.Decimal("10000.50"),
    ),
    ).toBe(true);

    expect(
    new Prisma.Decimal(result.balance.balanceAfter).eq(
        new Prisma.Decimal("12500.75"),
    ),
    ).toBe(true);

    expect(
    new Prisma.Decimal(result.balance.lockedBalance).eq(
        new Prisma.Decimal("500.00"),
    ),
    ).toBe(true);
    });

  it("should preserve exact Decimal calculation", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("100.10"),
        lockedBalance: new Prisma.Decimal("0"),
      },
    });

    const result = await prepareDeposit(
      {
        id: user.id,
        role: "CUSTOMER",
      } as AuthUser,
      account.id,
      {
        amount: "0.20",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    expect(
    new Prisma.Decimal(result.balance.balanceBefore).eq(
        new Prisma.Decimal("100.10"),
    ),
    ).toBe(true);

    expect(
    new Prisma.Decimal(result.balance.balanceAfter).eq(
        new Prisma.Decimal("100.30"),
    ),
    ).toBe(true);
    });

  it("should create a balance row when currency balance does not exist", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    const result = await prepareDeposit(
      {
        id: user.id,
        role: "CUSTOMER",
      } as AuthUser,
      account.id,
      {
        amount: "750.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    expect(result.balance.balanceBefore).toBe("0");
    expect(result.balance.balanceAfter).toBe("750");
    expect(result.balance.lockedBalance).toBe("0");

    const balance = await prisma.accountBalance.findUnique({
      where: {
        accountId_currencyCode: {
          accountId: account.id,
          currencyCode: "BDT",
        },
      },
    });

    expect(balance).not.toBeNull();
    expect(balance?.availableBalance.toString()).toBe("750");
  });

  it("should not modify locked balance during deposit", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("5000"),
        lockedBalance: new Prisma.Decimal("1200"),
      },
    });

    const result = await prepareDeposit(
      {
        id: user.id,
        role: "CUSTOMER",
      } as AuthUser,
      account.id,
      {
        amount: "1000",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    expect(result.balance.balanceAfter).toBe("6000");
    expect(result.balance.lockedBalance).toBe("1200");
  });

  it("should reject another customer's account without changing balance", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();

    const account = await createTestAccount(owner.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("5000"),
        lockedBalance: new Prisma.Decimal("0"),
      },
    });

    await expect(
      prepareDeposit(
        {
          id: attacker.id,
          role: "CUSTOMER",
        } as AuthUser,
        account.id,
        {
          amount: "1000",
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
    });

    const balance = await prisma.accountBalance.findUnique({
      where: {
        accountId_currencyCode: {
          accountId: account.id,
          currencyCode: "BDT",
        },
      },
    });

    expect(balance?.availableBalance.toString()).toBe("5000");
  });
});

afterAll(async () => {
  if (createdTransactionIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        transactionId: {
          in: createdTransactionIds,
        },
      },
    });

    await prisma.transactionLeg.deleteMany({
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
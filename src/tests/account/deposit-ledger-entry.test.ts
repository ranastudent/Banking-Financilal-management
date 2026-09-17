import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { prepareDeposit } from "../../transaction/services/deposit.service";
import type { AuthUser } from "../../types/auth";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdTransactionIds: string[] = [];

const createTestUser = async () => {
  const user = await prisma.user.create({
    data: {
      name: `Deposit Ledger User ${Date.now()}-${Math.random()}`,
      email: `deposit-ledger-${Date.now()}-${Math.random()}@test.local`,
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
      accountNumber: `DLED-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const customerAuth = (
  user: Awaited<ReturnType<typeof createTestUser>>,
): AuthUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  status: user.status,
});

describe("Deposit Ledger Entry", () => {
  it("should create a CREDIT ledger entry for a deposit", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("1000.00"),
        lockedBalance: new Prisma.Decimal("0"),
      },
    });

    const result = await prepareDeposit(
      customerAuth(user),
      account.id,
      {
        amount: "250.50",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    expect(result.ledgerEntry.entryType).toBe("CREDIT");
    expect(result.ledgerEntry.transactionId).toBe(
      result.transaction.id,
    );
    expect(result.ledgerEntry.accountId).toBe(account.id);
    expect(result.ledgerEntry.currencyCode).toBe("BDT");
  });

  it("should store the exact deposit amount in the ledger", async () => {
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
      customerAuth(user),
      account.id,
      {
        amount: "0.20",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    expect(
      new Prisma.Decimal(result.ledgerEntry.amount).eq(
        new Prisma.Decimal("0.20"),
      ),
    ).toBe(true);
  });

  it("should record the correct balance before and after deposit", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("1000.25"),
        lockedBalance: new Prisma.Decimal("50.00"),
      },
    });

    const result = await prepareDeposit(
      customerAuth(user),
      account.id,
      {
        amount: "99.75",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    expect(
      new Prisma.Decimal(result.ledgerEntry.balanceBefore).eq(
        new Prisma.Decimal("1000.25"),
      ),
    ).toBe(true);

    expect(
      new Prisma.Decimal(result.ledgerEntry.balanceAfter).eq(
        new Prisma.Decimal("1100.00"),
      ),
    ).toBe(true);
  });

  it("should persist the ledger entry in the database", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("5000"),
        lockedBalance: new Prisma.Decimal("0"),
      },
    });

    const result = await prepareDeposit(
      customerAuth(user),
      account.id,
      {
        amount: "500",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    const ledgerEntry = await prisma.ledgerEntry.findUnique({
      where: {
        id: result.ledgerEntry.id,
      },
    });

    expect(ledgerEntry).not.toBeNull();
    expect(ledgerEntry?.transactionId).toBe(
      result.transaction.id,
    );
    expect(ledgerEntry?.accountId).toBe(account.id);
    expect(ledgerEntry?.currencyCode).toBe("BDT");
    expect(ledgerEntry?.entryType).toBe("CREDIT");

    expect(
      new Prisma.Decimal(ledgerEntry!.amount).eq(
        new Prisma.Decimal("500"),
      ),
    ).toBe(true);
  });

  it("should not create a ledger entry for unauthorized customer", async () => {
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
        customerAuth(attacker),
        account.id,
        {
          amount: "1000",
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
    });

    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: {
        accountId: account.id,
      },
    });

    expect(ledgerEntries).toHaveLength(0);
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
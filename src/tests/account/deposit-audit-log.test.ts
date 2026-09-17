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
      name: `Deposit Audit User ${Date.now()}-${Math.random()}`,
      email: `deposit-audit-${Date.now()}-${Math.random()}@test.local`,
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
      accountNumber: `DAUD-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
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

describe("Deposit Audit Log", () => {
  it("should create an audit log for a successful deposit", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("1000"),
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

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        userId: user.id,
        action: "DEPOSIT_CREATED",
        entityType: "TRANSACTION",
        entityId: result.transaction.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(auditLog).not.toBeNull();

    expect(auditLog?.userId).toBe(user.id);
    expect(auditLog?.action).toBe("DEPOSIT_CREATED");
    expect(auditLog?.entityType).toBe("TRANSACTION");
    expect(auditLog?.entityId).toBe(result.transaction.id);
  });

  it("should store useful deposit information in audit metadata", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("2000"),
        lockedBalance: new Prisma.Decimal("0"),
      },
    });

    const result = await prepareDeposit(
      customerAuth(user),
      account.id,
      {
        amount: "750.25",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        userId: user.id,
        action: "DEPOSIT_CREATED",
        entityId: result.transaction.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(auditLog).not.toBeNull();

    const metadata = auditLog?.metadata as Record<string, unknown>;

    expect(metadata.operation).toBe("ACCOUNT_DEPOSIT");
    expect(metadata.transactionId).toBe(result.transaction.id);
    expect(metadata.transactionReference).toBe(
      result.transaction.reference,
    );
    expect(metadata.accountId).toBe(account.id);
    expect(metadata.accountNumber).toBe(account.accountNumber);
    expect(metadata.amount).toBe("750.25");
    expect(metadata.currencyCode).toBe("BDT");
    expect(metadata.userRole).toBe("CUSTOMER");
  });

  it("should store the correct description", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(user.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: new Prisma.Decimal("3000"),
        lockedBalance: new Prisma.Decimal("0"),
      },
    });

    const result = await prepareDeposit(
      customerAuth(user),
      account.id,
      {
        amount: "250",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        userId: user.id,
        entityId: result.transaction.id,
        action: "DEPOSIT_CREATED",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(auditLog).not.toBeNull();

    expect(auditLog?.description).toContain(
      result.transaction.reference,
    );

    expect(auditLog?.description).toContain(
      account.accountNumber,
    );
  });

  it("should persist the audit log with the transaction", async () => {
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
        amount: "1000",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(result.transaction.id);

    const logs = await prisma.auditLog.findMany({
      where: {
        entityId: result.transaction.id,
        action: "DEPOSIT_CREATED",
      },
    });

    expect(logs).toHaveLength(1);
    const [auditLog] = logs;
    if (!auditLog) {
     throw new Error("Expected audit log was not found");
    };
    expect(auditLog.userId).toBe(user.id);
  });

  it("should not create an audit log for an unauthorized deposit", async () => {
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

    const logs = await prisma.auditLog.findMany({
      where: {
        userId: attacker.id,
        action: "DEPOSIT_CREATED",
      },
    });

    expect(logs).toHaveLength(0);
  });
});

afterAll(async () => {
  if (createdTransactionIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        entityId: {
          in: createdTransactionIds,
        },
        action: "DEPOSIT_CREATED",
      },
    });

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
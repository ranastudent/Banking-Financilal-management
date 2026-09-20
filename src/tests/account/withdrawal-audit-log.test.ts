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
import { cleanupWithdrawalTestData } from "../helpers/withdrawal-test-cleanup";

describe("13.13 Withdrawal Audit Log", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
  });

  afterEach(async () => {
    await cleanupWithdrawalTestData({
      transactionIds: createdTransactionIds,
      accountIds: createdAccountIds,
      userIds: createdUserIds,
    });

    createdTransactionIds.length = 0;
    createdAccountIds.length = 0;
    createdUserIds.length = 0;
  });

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Withdrawal Audit ${Date.now()}-${Math.random()}`,
        email: `withdrawal-audit-${Date.now()}-${Math.random()}@example.com`,
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
        accountNumber: `WD-AUDIT-${Date.now()}-${Math.random()
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
    availableBalance: string,
    lockedBalance = "0",
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance:
          new Prisma.Decimal(availableBalance),
        lockedBalance:
          new Prisma.Decimal(lockedBalance),
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

  it("should create an audit log for a successful withdrawal", async () => {
    const user = await createUser();
    const account = await createAccount(user.id);

    await createBalance(
      account.id,
      "5000.00",
    );

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "1000.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    const auditLog =
      await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: "WITHDRAWAL_CREATED",
          entityType: "TRANSACTION",
          entityId: result.transaction.id,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    expect(auditLog).not.toBeNull();

    expect(auditLog?.userId).toBe(user.id);
    expect(auditLog?.action).toBe(
      "WITHDRAWAL_CREATED",
    );
    expect(auditLog?.entityType).toBe(
      "TRANSACTION",
    );
    expect(auditLog?.entityId).toBe(
      result.transaction.id,
    );
  });

  it("should store useful withdrawal information in audit metadata", async () => {
    const user = await createUser();
    const account = await createAccount(user.id);

    await createBalance(
      account.id,
      "3000.00",
    );

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "750.25",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    const auditLog =
      await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: "WITHDRAWAL_CREATED",
          entityId: result.transaction.id,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    expect(auditLog).not.toBeNull();

    const metadata =
      auditLog?.metadata as Record<
        string,
        unknown
      >;

    expect(metadata.operation).toBe(
      "ACCOUNT_WITHDRAWAL",
    );

    expect(metadata.transactionId).toBe(
      result.transaction.id,
    );

    expect(
      metadata.transactionReference,
    ).toBe(
      result.transaction.reference,
    );

    expect(metadata.accountId).toBe(
      account.id,
    );

    expect(metadata.accountNumber).toBe(
      account.accountNumber,
    );

    expect(metadata.amount).toBe(
      "750.25",
    );

    expect(metadata.currencyCode).toBe(
      "BDT",
    );

    expect(metadata.userRole).toBe(
      "CUSTOMER",
    );
  });

  it("should store the correct description", async () => {
    const user = await createUser();
    const account = await createAccount(user.id);

    await createBalance(
      account.id,
      "2000.00",
    );

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "250.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    const auditLog =
      await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: "WITHDRAWAL_CREATED",
          entityId: result.transaction.id,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    expect(auditLog).not.toBeNull();

    expect(
      auditLog?.description,
    ).toContain(
      result.transaction.reference,
    );

    expect(
      auditLog?.description,
    ).toContain(
      account.accountNumber,
    );
  });

  it("should persist exactly one audit log for the withdrawal", async () => {
    const user = await createUser();
    const account = await createAccount(user.id);

    await createBalance(
      account.id,
      "5000.00",
    );

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "1000.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    const logs =
      await prisma.auditLog.findMany({
        where: {
          userId: user.id,
          action: "WITHDRAWAL_CREATED",
          entityId: result.transaction.id,
        },
      });

    expect(logs).toHaveLength(1);

    const [auditLog] = logs;

    if (!auditLog) {
      throw new Error(
        "Expected withdrawal audit log was not found",
      );
    }

    expect(auditLog.userId).toBe(
      user.id,
    );

    expect(auditLog.entityId).toBe(
      result.transaction.id,
    );
  });

  it("should not create an audit log for an unauthorized withdrawal", async () => {
    const owner = await createUser();
    const attacker = await createUser();

    const account =
      await createAccount(owner.id);

    await createBalance(
      account.id,
      "5000.00",
    );

    await expect(
      prepareWithdrawal(
        buildAuthUser(attacker),
        account.id,
        {
          amount: "1000.00",
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
    });

    const logs =
      await prisma.auditLog.findMany({
        where: {
          userId: attacker.id,
          action: "WITHDRAWAL_CREATED",
        },
      });

    expect(logs).toHaveLength(0);
  });
});
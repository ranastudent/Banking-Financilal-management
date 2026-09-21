import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  Prisma,
  UserStatus,
} from "@prisma/client";

import { prisma } from "../../config/prisma";
import { hashPassword } from "../../auth/utils/password";
import {
  prepareWithdrawal,
} from "../../transaction/services/withdrawal.service";
import type { AuthUser } from "../../types/auth";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

const createTestUser = async () => {
  const user =
    await prisma.user.create({
      data: {
        name: `Withdrawal Rollback ${Date.now()}-${Math.random()}`,
        email: `withdrawal-rollback-${Date.now()}-${Math.random()}@test.local`,
        passwordHash:
          await hashPassword(
            "TestPassword123!",
          ),
        role: "CUSTOMER",
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

  createdUserIds.push(user.id);

  return user;
};

const createTestAccount = async (
  userId: string,
  balance = "10000.00",
) => {
  const account =
    await prisma.account.create({
      data: {
        userId,
        accountNumber:
          `WROLL-${Date.now()}-${Math.floor(
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
      availableBalance:
        new Prisma.Decimal(balance),
      lockedBalance:
        new Prisma.Decimal("0"),
    },
  });

  return account;
};

const createAuthUser = (
  user: Awaited<
    ReturnType<typeof createTestUser>
  >,
): AuthUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  status: user.status,
});

const getBalance = async (
  accountId: string,
) => {
  return prisma.accountBalance.findUnique({
    where: {
      accountId_currencyCode: {
        accountId,
        currencyCode: "BDT",
      },
    },
  });
};

const cleanup = async () => {
  if (createdAccountIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        entityId: {
          in: (
            await prisma.transaction.findMany({
              where: {
                sourceAccountId: {
                  in: createdAccountIds,
                },
              },
              select: {
                id: true,
              },
            })
          ).map(
            (transaction) =>
              transaction.id,
          ),
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

    await prisma.auditLog.deleteMany({
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
};

afterEach(async () => {
  await cleanup();
});

describe(
  "13.15 Withdrawal Rollback / Failure Integrity",
  () => {
    it("should rollback balance when failure occurs immediately after debit", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
          "10000.00",
        );

      await expect(
        prepareWithdrawal(
          createAuthUser(user),
          account.id,
          {
            amount: "500.00",
            currency: "BDT",
          },
          {
            failurePoint:
              "after-debit",
          },
        ),
      ).rejects.toThrow(
        "Simulated withdrawal failure at after-debit",
      );

      const balance =
        await getBalance(
          account.id,
        );

      expect(balance).not.toBeNull();

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "10000.00",
          ),
        ),
      ).toBe(true);

      const transactions =
        await prisma.transaction.findMany(
          {
            where: {
              sourceAccountId:
                account.id,
              type: "WITHDRAWAL",
            },
          },
        );

      expect(transactions).toHaveLength(
        0,
      );
    });

    it("should rollback balance and transaction when failure occurs after transaction creation", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
          "10000.00",
        );

      await expect(
        prepareWithdrawal(
          createAuthUser(user),
          account.id,
          {
            amount: "500.00",
            currency: "BDT",
          },
          {
            failurePoint:
              "after-transaction",
          },
        ),
      ).rejects.toThrow(
        "Simulated withdrawal failure at after-transaction",
      );

      const balance =
        await getBalance(
          account.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "10000.00",
          ),
        ),
      ).toBe(true);

      const transactions =
        await prisma.transaction.findMany(
          {
            where: {
              sourceAccountId:
                account.id,
              type: "WITHDRAWAL",
            },
          },
        );

      expect(transactions).toHaveLength(
        0,
      );

      const ledgerEntries =
        await prisma.ledgerEntry.findMany(
          {
            where: {
              accountId: account.id,
            },
          },
        );

      expect(
        ledgerEntries,
      ).toHaveLength(0);
    });

    it("should rollback transaction, balance, and ledger when failure occurs after ledger creation", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
          "10000.00",
        );

      await expect(
        prepareWithdrawal(
          createAuthUser(user),
          account.id,
          {
            amount: "750.00",
            currency: "BDT",
          },
          {
            failurePoint:
              "after-ledger",
          },
        ),
      ).rejects.toThrow(
        "Simulated withdrawal failure at after-ledger",
      );

      const balance =
        await getBalance(
          account.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "10000.00",
          ),
        ),
      ).toBe(true);

      const transactions =
        await prisma.transaction.findMany(
          {
            where: {
              sourceAccountId:
                account.id,
              type: "WITHDRAWAL",
            },
          },
        );

      expect(transactions).toHaveLength(
        0,
      );

      const ledgerEntries =
        await prisma.ledgerEntry.findMany(
          {
            where: {
              accountId: account.id,
            },
          },
        );

      expect(
        ledgerEntries,
      ).toHaveLength(0);
    });

    it("should rollback everything when failure occurs after audit log creation", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
          "10000.00",
        );

      await expect(
        prepareWithdrawal(
          createAuthUser(user),
          account.id,
          {
            amount: "1000.00",
            currency: "BDT",
          },
          {
            failurePoint:
              "after-audit",
          },
        ),
      ).rejects.toThrow(
        "Simulated withdrawal failure at after-audit",
      );

      const balance =
        await getBalance(
          account.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "10000.00",
          ),
        ),
      ).toBe(true);

      const transactions =
        await prisma.transaction.findMany(
          {
            where: {
              sourceAccountId:
                account.id,
              type: "WITHDRAWAL",
            },
          },
        );

      expect(transactions).toHaveLength(
        0,
      );

      const ledgerEntries =
        await prisma.ledgerEntry.findMany(
          {
            where: {
              accountId: account.id,
            },
          },
        );

      expect(
        ledgerEntries,
      ).toHaveLength(0);

      const auditLogs =
        await prisma.auditLog.findMany({
          where: {
            userId: user.id,
            action:
              "WITHDRAWAL_CREATED",
          },
        });

      expect(
        auditLogs,
      ).toHaveLength(0);
    });

    it("should preserve locked balance when rollback occurs", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
          "10000.00",
        );

      await prisma.accountBalance.update({
        where: {
          accountId_currencyCode: {
            accountId: account.id,
            currencyCode: "BDT",
          },
        },
        data: {
          lockedBalance:
            new Prisma.Decimal(
              "750.00",
            ),
        },
      });

      await expect(
        prepareWithdrawal(
          createAuthUser(user),
          account.id,
          {
            amount: "500.00",
            currency: "BDT",
          },
          {
            failurePoint:
              "after-audit",
          },
        ),
      ).rejects.toThrow(
        "Simulated withdrawal failure at after-audit",
      );

      const balance =
        await getBalance(
          account.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "10000.00",
          ),
        ),
      ).toBe(true);

      expect(
        balance?.lockedBalance.eq(
          new Prisma.Decimal(
            "750.00",
          ),
        ),
      ).toBe(true);
    });
  },
);
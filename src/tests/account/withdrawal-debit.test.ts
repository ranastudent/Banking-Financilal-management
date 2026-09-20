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

describe("13.10 Withdrawal Account Debit", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
  });

  afterEach(async () => {
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
        name: `Withdrawal Debit ${Date.now()}`,
        email: `withdrawal-debit-${Date.now()}-${Math.random()}@example.com`,
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
        accountNumber: `WD-DEBIT-${Date.now()}-${Math.random()
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
    lockedBalance: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance:
          new Prisma.Decimal(
            availableBalance,
          ),
        lockedBalance:
          new Prisma.Decimal(
            lockedBalance,
          ),
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

  it("should debit only availableBalance", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    const balance =
      await createBalance(
        account.id,
        "1000.00",
        "300.00",
      );

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "250.00",
        currency: "BDT",
      },
    );

    expect(
      result.balanceBefore,
    ).toBe("1000");

    expect(
      result.balanceAfter,
    ).toBe("750");

    expect(
      result.lockedBalance,
    ).toBe("300");

    const balanceAfter =
      await prisma.accountBalance.findUnique(
        {
          where: {
            id: balance.id,
          },
        },
      );

    expect(
      balanceAfter?.availableBalance.toString(),
    ).toBe("750");

    expect(
      balanceAfter?.lockedBalance.toString(),
    ).toBe("300");
  });

  it("should allow the balance to reach exactly zero", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    const balance =
      await createBalance(
        account.id,
        "1000.00",
        "0.00",
      );

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "1000.00",
        currency: "BDT",
      },
    );

    expect(
      result.balanceBefore,
    ).toBe("1000");

    expect(
      result.balanceAfter,
    ).toBe("0");

    const balanceAfter =
      await prisma.accountBalance.findUnique(
        {
          where: {
            id: balance.id,
          },
        },
      );

    expect(
      balanceAfter?.availableBalance.toString(),
    ).toBe("0");
  });

  it("should never create a negative available balance", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    const balance =
      await createBalance(
        account.id,
        "1000.00",
        "0.00",
      );

    await expect(
      prepareWithdrawal(
        buildAuthUser(user),
        account.id,
        {
          amount: "1000.01",
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "INSUFFICIENT_BALANCE",
    });

    const balanceAfter =
      await prisma.accountBalance.findUnique(
        {
          where: {
            id: balance.id,
          },
        },
      );

    expect(
      balanceAfter?.availableBalance.toString(),
    ).toBe("1000");
  });
});
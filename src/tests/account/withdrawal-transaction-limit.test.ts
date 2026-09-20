import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { Prisma } from "@prisma/client";

import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { prepareWithdrawal } from "../../transaction/services/withdrawal.service";
import type { AuthUser } from "../../types/auth";

describe("13.9 Withdrawal Transaction Limit", () => {
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
        name: `Withdrawal Limit ${Date.now()}`,
        email: `withdrawal-limit-${Date.now()}-${Math.random()}@example.com`,
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
        accountNumber: `WD-LIMIT-${Date.now()}-${Math.random()
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
    amount: Prisma.Decimal,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance: amount,
        lockedBalance: new Prisma.Decimal("0"),
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

  it("should allow a withdrawal exactly equal to the transaction limit", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    const maximumAmount =
      new Prisma.Decimal(
        env.withdrawal.maxAmount,
      );

    await createBalance(
      account.id,
      maximumAmount.add("1000"),
    );

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount:
          maximumAmount.toString(),
        currency: "BDT",
      },
    );

    expect(
      result.amount.toString(),
    ).toBe(
      maximumAmount.toString(),
    );

    expect(
      result.balanceBefore,
    ).toBe(
      maximumAmount
        .add("1000")
        .toString(),
    );

    expect(
      result.balanceAfter,
    ).toBe("1000");
  });

  it("should reject a withdrawal above the transaction limit", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    const maximumAmount =
      new Prisma.Decimal(
        env.withdrawal.maxAmount,
      );

    const balance =
      await createBalance(
        account.id,
        maximumAmount.add("1000"),
      );

    const requestedAmount =
      maximumAmount.add("0.01");

    await expect(
      prepareWithdrawal(
        buildAuthUser(user),
        account.id,
        {
          amount:
            requestedAmount.toString(),
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "TRANSACTION_LIMIT_EXCEEDED",
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
    ).toBe(
      maximumAmount
        .add("1000")
        .toString(),
    );
  });

  it("should reject the limit check only after confirming sufficient balance", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    const maximumAmount =
      new Prisma.Decimal(
        env.withdrawal.maxAmount,
      );

    await createBalance(
      account.id,
      maximumAmount.sub("1"),
    );

    /*
     * This request is above the configured limit,
     * but it also exceeds the available balance.
     *
     * Because the financial flow checks balance first,
     * INSUFFICIENT_BALANCE is expected.
     */
    const requestedAmount =
      maximumAmount.add("0.01");

    await expect(
      prepareWithdrawal(
        buildAuthUser(user),
        account.id,
        {
          amount:
            requestedAmount.toString(),
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "INSUFFICIENT_BALANCE",
    });
  });
});
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

describe("13.8 Withdrawal Insufficient Balance Protection", () => {
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

    createdAccountIds.length = 0;
    createdUserIds.length = 0;
  });

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Withdrawal Insufficient ${Date.now()}`,
        email: `withdrawal-insufficient-${Date.now()}-${Math.random()}@example.com`,
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
        accountNumber: `WD-INS-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    return account;
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

  const createBalance = async (
    accountId: string,
    available: string,
    locked = "0",
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance:
          new Prisma.Decimal(available),
        lockedBalance:
          new Prisma.Decimal(locked),
      },
    });
  };

  it("should allow withdrawal when amount equals available balance", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    await createBalance(
      account.id,
      "1000.00",
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
      result.balance.availableBalance,
    ).toBe("1000");

    expect(
      result.amount.toString(),
    ).toBe("1000");
  });

  it("should reject withdrawal when amount exceeds available balance", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    const balance = await createBalance(
      account.id,
      "1000.00",
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

    /*
     * 13.8 only checks the balance.
     * No financial mutation has happened yet.
     */
    const balanceAfter =
      await prisma.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

    expect(
      balanceAfter?.availableBalance.toString(),
    ).toBe("1000");
  });

  it("should reject withdrawal when there is no balance row for the requested currency", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    /*
     * Only BDT balance exists.
     */
    await createBalance(
      account.id,
      "1000.00",
    );

    await expect(
      prepareWithdrawal(
        buildAuthUser(user),
        account.id,
        {
          amount: "100.00",
          currency: "USD",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "INSUFFICIENT_BALANCE",
    });

    /*
     * No USD balance row should be created
     * as a side effect of the failed check.
     */
    const usdBalance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: account.id,
            currencyCode: "USD",
          },
        },
      });

    expect(usdBalance).toBeNull();
  });

  it("should use available balance only and never count locked balance", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    await createBalance(
      account.id,
      "1000.00",
      "5000.00",
    );

    /*
     * Total stored money may be 6000,
     * but only 1000 is available for withdrawal.
     */
    await expect(
      prepareWithdrawal(
        buildAuthUser(user),
        account.id,
        {
          amount: "1500.00",
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "INSUFFICIENT_BALANCE",
    });
  });
});
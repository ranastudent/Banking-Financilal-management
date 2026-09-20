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

describe("13.7 Withdrawal Balance Lookup", () => {
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
        name: `Withdrawal Balance ${Date.now()}`,
        email: `withdrawal-balance-${Date.now()}-${Math.random()}@example.com`,
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
        accountNumber: `WD-BAL-${Date.now()}-${Math.random()
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

  it("should lookup the balance for the requested currency", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    await prisma.accountBalance.createMany({
      data: [
        {
          accountId: account.id,
          currencyCode: "BDT",
          availableBalance:
            new Prisma.Decimal("10000.00"),
          lockedBalance:
            new Prisma.Decimal("500.00"),
        },
        {
          accountId: account.id,
          currencyCode: "USD",
          availableBalance:
            new Prisma.Decimal("500.00"),
          lockedBalance:
            new Prisma.Decimal("50.00"),
        },
      ],
    });

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "300.00",
        currency: "USD",
      },
    );

    expect(result.balance.id).toEqual(
      expect.any(String),
    );

    expect(
      result.balance.currencyCode,
    ).toBe("USD");

    expect(
      result.balance.availableBalance,
    ).toBe("500");

    expect(
      result.balance.lockedBalance,
    ).toBe("50");

    /*
     * The BDT balance must not be accidentally used.
     */
    expect(
      result.balance.availableBalance,
    ).not.toBe("10000");
  });

  it("should read only the requested currency balance", async () => {
    const user = await createUser();
    const account = await createAccount(
      user.id,
    );

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance:
          new Prisma.Decimal("10000.00"),
        lockedBalance:
          new Prisma.Decimal("0"),
      },
    });

    /*
     * USD has no AccountBalance row.
     *
     * The service should see zero USD funds and
     * reject the withdrawal as insufficient.
     */
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
  });
});
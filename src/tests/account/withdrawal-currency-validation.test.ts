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

describe("13.6 Withdrawal Currency Validation", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];

  let createdTestCurrency = false;
  let originalXzzActiveState: boolean | null = null;

  beforeEach(async () => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;

    createdTestCurrency = false;
    originalXzzActiveState = null;

    const existingCurrency =
      await prisma.currency.findUnique({
        where: {
          code: "XZZ",
        },
      });

    if (!existingCurrency) {
      await prisma.currency.create({
        data: {
          code: "XZZ",
          name: "Withdrawal Test Currency",
          symbol: "X",
          decimalPlaces: 2,
          isActive: true,
        },
      });

      createdTestCurrency = true;
    } else {
      /*
       * Preserve the original database state.
       */
      originalXzzActiveState =
        existingCurrency.isActive;

      if (!existingCurrency.isActive) {
        await prisma.currency.update({
          where: {
            code: "XZZ",
          },
          data: {
            isActive: true,
          },
        });
      }
    }
  });

  afterEach(async () => {
    /*
     * Delete child rows before account rows.
     */
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

    /*
     * Delete user-dependent rows before users.
     */
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

    /*
     * Restore or remove XZZ.
     */
    if (createdTestCurrency) {
      await prisma.currency.delete({
        where: {
          code: "XZZ",
        },
      });
    } else if (
      originalXzzActiveState !== null
    ) {
      await prisma.currency.update({
        where: {
          code: "XZZ",
        },
        data: {
          isActive: originalXzzActiveState,
        },
      });
    }

    createdAccountIds.length = 0;
    createdUserIds.length = 0;
  });

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Withdrawal Currency ${Date.now()}`,
        email: `withdrawal-currency-${Date.now()}-${Math.random()}@example.com`,
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
        accountNumber: `WD-CUR-${Date.now()}-${Math.random()
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
    currencyCode: string,
    availableBalance: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode,
        availableBalance:
          new Prisma.Decimal(availableBalance),
        lockedBalance:
          new Prisma.Decimal("0"),
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

  it("should accept an active supported currency", async () => {
    const user = await createUser();

    const account = await createAccount(
      user.id,
    );

    /*
     * The service continues from currency validation
     * into balance validation, so provide enough BDT
     * balance for the successful test.
     */
    await createBalance(
      account.id,
      "BDT",
      "1000.00",
    );

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "100.00",
        currency: "BDT",
      },
    );

    expect(result.currency.code).toBe(
      "BDT",
    );

    expect(
      result.currency.isActive,
    ).toBe(true);

    expect(
      result.amount.toString(),
    ).toBe("100");

    expect(
      result.balance.availableBalance,
    ).toBe("1000");
  });

  it("should accept XZZ when the test currency is active", async () => {
    const user = await createUser();

    const account = await createAccount(
      user.id,
    );

    /*
     * XZZ must have sufficient balance because
     * prepareWithdrawal() continues through 13.8.
     */
    await createBalance(
      account.id,
      "XZZ",
      "1000.00",
    );

    const result = await prepareWithdrawal(
      buildAuthUser(user),
      account.id,
      {
        amount: "100.00",
        currency: "XZZ",
      },
    );

    expect(result.currency.code).toBe(
      "XZZ",
    );

    expect(
      result.currency.isActive,
    ).toBe(true);

    expect(
      result.balance.availableBalance,
    ).toBe("1000");
  });

  it("should reject an unsupported currency", async () => {
    const user = await createUser();

    const account = await createAccount(
      user.id,
    );

    /*
     * No balance is required here because the
     * currency lookup fails before balance lookup.
     */
    await expect(
      prepareWithdrawal(
        buildAuthUser(user),
        account.id,
        {
          amount: "100.00",
          currency: "ZZZ",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("should reject an inactive currency", async () => {
    const user = await createUser();

    const account = await createAccount(
      user.id,
    );

    await prisma.currency.update({
      where: {
        code: "XZZ",
      },
      data: {
        isActive: false,
      },
    });

    /*
     * Currency validation fails before balance lookup,
     * so no balance is required for this test.
     */
    await expect(
      prepareWithdrawal(
        buildAuthUser(user),
        account.id,
        {
          amount: "100.00",
          currency: "XZZ",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONFLICT",
    });
  });
});